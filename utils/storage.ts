import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import i18n, { getDateLocale } from '@/i18n';
import { encodeDecibelData, decodeDecibelData } from '@/utils/decibel-codec';
import { analyzeSnoringAuto } from '@/utils/snore-detection';

// 分贝数据点 - 每秒一个采样点
export interface DecibelDataPoint {
  timestamp: number; // 相对于录音开始的毫秒数
  decibel: number;   // 分贝值 (0-120)
  isSnoring?: boolean; // 已废弃：是否打鼾由分析函数产出，不再逐点存储
}

// 录音元数据（不含分贝数据，用于列表显示）
export interface RecordingMeta {
  id: string;
  uri: string;
  createdAt: number;
  duration: number; // in milliseconds
  analysis?: SnoreAnalysis;
  threshold?: number; // 打鼾阈值
  dataPointCount?: number; // 分贝数据点数量
}

// 完整录音数据（含分贝数据）
export interface Recording extends RecordingMeta {
  decibelData: DecibelDataPoint[]; // 分贝数据
}

export interface SnoreAnalysis {
  hasSnoring: boolean;
  snoreCount: number;        // 打鼾事件次数
  snoreDuration: number;     // 总打鼾秒数
  maxDecibel: number;        // 最大分贝
  avgDecibel: number;        // 平均分贝
  avgSnoringDecibel: number; // 打鼾时平均分贝
  severity: 'none' | 'mild' | 'moderate' | 'severe';
  analyzedAt: number;
  snoreEvents: SnoreEvent[]; // 打鼾事件列表
  method?: 'auto' | 'threshold'; // 分析方式：自动识别 / 固定阈值（旧版）
}

export interface SnoreEvent {
  startTime: number;  // 开始时间（毫秒）
  endTime: number;    // 结束时间（毫秒）
  maxDecibel: number; // 该事件最大分贝
  confidence?: number; // 自动识别的置信度 (0~1)
}

// 打鼾检测阈值 (分贝)
export const SNORE_THRESHOLD_DB = 45;

const RECORDINGS_META_KEY = 'sleep_recordings_meta'; // 只存元数据
const RECORDINGS_KEY = 'sleep_recordings'; // 旧版兼容

// 获取分贝数据的存储 key
function getDecibelDataKey(id: string): string {
  return `decibel_data_${id}`;
}

// ---- 高频分贝数据（250ms 采样，二进制文件存储，一晚约 113KB）----
// 用于打鼾自动识别和将来的算法升级重分析；图表和 AsyncStorage 仍用每秒聚合数据

function getFullRateFile(id: string): File {
  return new File(Paths.document, `decibel_${id}.bin`);
}

// 保存录音的高频分贝数据
export function saveFullRateData(id: string, data: DecibelDataPoint[]): void {
  try {
    getFullRateFile(id).write(encodeDecibelData(data));
  } catch (error) {
  }
}

// 读取录音的高频分贝数据（不存在或格式错误时返回 null）
export function loadFullRateData(id: string): DecibelDataPoint[] | null {
  try {
    const file = getFullRateFile(id);
    if (!file.exists) return null;
    return decodeDecibelData(file.bytesSync());
  } catch (error) {
    return null;
  }
}

// 获取录音列表（只返回元数据，不含分贝数据）
export async function getRecordingsMeta(): Promise<RecordingMeta[]> {
  try {
    // 先尝试读取新格式
    const metaData = await AsyncStorage.getItem(RECORDINGS_META_KEY);
    if (metaData) {
      return JSON.parse(metaData);
    }
    
    // 兼容旧格式：从旧数据迁移
    const oldData = await AsyncStorage.getItem(RECORDINGS_KEY);
    if (oldData) {
      const oldRecordings: Recording[] = JSON.parse(oldData);
      // 迁移到新格式
      await migrateToNewFormat(oldRecordings);
      // 返回元数据
      return oldRecordings.map(r => ({
        id: r.id,
        uri: r.uri,
        createdAt: r.createdAt,
        duration: r.duration,
        analysis: r.analysis,
        threshold: r.threshold,
        dataPointCount: r.decibelData?.length || 0,
      }));
    }
    
    return [];
  } catch (error) {
    return [];
  }
}

// 迁移旧数据到新格式
async function migrateToNewFormat(oldRecordings: Recording[]): Promise<void> {
  try {
    const metas: RecordingMeta[] = [];
    
    for (const recording of oldRecordings) {
      // 保存分贝数据到单独的 key
      if (recording.decibelData && recording.decibelData.length > 0) {
        await AsyncStorage.setItem(
          getDecibelDataKey(recording.id),
          JSON.stringify(recording.decibelData)
        );
      }
      
      // 提取元数据
      metas.push({
        id: recording.id,
        uri: recording.uri,
        createdAt: recording.createdAt,
        duration: recording.duration,
        analysis: recording.analysis,
        threshold: recording.threshold,
        dataPointCount: recording.decibelData?.length || 0,
      });
    }
    
    // 保存元数据列表
    await AsyncStorage.setItem(RECORDINGS_META_KEY, JSON.stringify(metas));
    
    // 删除旧数据
    await AsyncStorage.removeItem(RECORDINGS_KEY);
  } catch (error) {
  }
}

// 获取单个录音的分贝数据
export async function getDecibelData(id: string): Promise<DecibelDataPoint[] | null> {
  try {
    const data = await AsyncStorage.getItem(getDecibelDataKey(id));
    if (data) {
      return JSON.parse(data);
    }
    return null;
  } catch (error) {
    return null;
  }
}

// 保存录音（分离存储）
export async function saveRecording(recording: Recording, fullRateData?: DecibelDataPoint[]): Promise<void> {
  try {
    // 1. 保存分贝数据到单独的 key
    if (recording.decibelData && recording.decibelData.length > 0) {
      await AsyncStorage.setItem(
        getDecibelDataKey(recording.id),
        JSON.stringify(recording.decibelData)
      );
    }

    // 保存高频分贝数据到二进制文件
    if (fullRateData && fullRateData.length > 0) {
      saveFullRateData(recording.id, fullRateData);
    }

    // 2. 保存元数据
    const metas = await getRecordingsMeta();
    const meta: RecordingMeta = {
      id: recording.id,
      uri: recording.uri,
      createdAt: recording.createdAt,
      duration: recording.duration,
      analysis: recording.analysis,
      threshold: recording.threshold,
      dataPointCount: recording.decibelData?.length || 0,
    };
    metas.unshift(meta);
    await AsyncStorage.setItem(RECORDINGS_META_KEY, JSON.stringify(metas));
  } catch (error) {
    throw error;
  }
}

// 获取单个录音（含分贝数据）
export async function getRecording(id: string): Promise<Recording | null> {
  try {
    const metas = await getRecordingsMeta();
    const meta = metas.find((r) => r.id === id);
    if (!meta) return null;
    
    // 加载分贝数据
    const decibelData = await getDecibelData(id);
    
    return {
      ...meta,
      decibelData: decibelData || [],
    };
  } catch (error) {
    return null;
  }
}

// 将旧录音（阈值分析或无分析）批量迁移为自动识别结果
// 一次性、幂等：迁移完所有录音的 analysis.method 都是 'auto'，再次调用会立即返回。
// 元数据只在最后统一写回一次（避免每条都全量重写），每处理一条通过 onProgress
// 回调让 UI 渐进刷新，并让出事件循环保持列表滑动流畅。
export async function migrateRecordingsToAuto(
  onProgress?: (metas: RecordingMeta[]) => void
): Promise<void> {
  try {
    const metas = await getRecordingsMeta();
    const hasPending = metas.some((m) => m.analysis?.method !== 'auto');
    if (!hasPending) return;

    let changed = false;
    for (let i = 0; i < metas.length; i++) {
      const meta = metas[i];
      if (meta.analysis?.method === 'auto') continue;

      // 优先用高频数据（250ms）重算，没有时退回每秒聚合数据
      const fullRate = loadFullRateData(meta.id);
      const source = fullRate && fullRate.length > 0
        ? fullRate
        : await getDecibelData(meta.id);
      if (!source || source.length === 0) continue;

      // 替换成新对象（而非原地修改），保证列表按 item 引用比较时能刷新该行
      metas[i] = { ...meta, analysis: analyzeSnoringAuto(source, meta.duration) };
      changed = true;
      onProgress?.([...metas]);

      // 让出事件循环，避免连续 CPU 占用阻塞 UI
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (changed) {
      await AsyncStorage.setItem(RECORDINGS_META_KEY, JSON.stringify(metas));
    }
  } catch (error) {
  }
}

// 更新录音
export async function updateRecording(id: string, updates: Partial<Recording>): Promise<void> {
  try {
    const metas = await getRecordingsMeta();
    const index = metas.findIndex((r) => r.id === id);
    if (index !== -1) {
      // 更新元数据
      const { decibelData, ...metaUpdates } = updates;
      metas[index] = { ...metas[index], ...metaUpdates };
      await AsyncStorage.setItem(RECORDINGS_META_KEY, JSON.stringify(metas));
      
      // 如果有分贝数据更新，单独保存
      if (decibelData) {
        await AsyncStorage.setItem(getDecibelDataKey(id), JSON.stringify(decibelData));
      }
    }
  } catch (error) {
    throw error;
  }
}

// 获取录音文件的 File 对象（兼容新旧格式）
// 新格式：相对路径（文件名）
// 旧格式：完整 URI（包含 file:// 和 UUID）
export function getRecordingFile(recordingMeta: RecordingMeta): File {
  // 新格式：相对路径
  if (!recordingMeta.uri.includes('://')) {
    return new File(Paths.document, recordingMeta.uri);
  }
  
  // 旧格式：完整 URI
  return new File(recordingMeta.uri);
}

// 检查录音 URI 是否需要迁移（旧格式 -> 新格式）
export function needsMigration(recordingMeta: RecordingMeta): boolean {
  return recordingMeta.uri.includes('://');
}

// 迁移单个录音的 URI（从完整 URI 转换为相对路径）
export async function migrateRecordingUri(id: string): Promise<void> {
  try {
    const metas = await getRecordingsMeta();
    const index = metas.findIndex((r) => r.id === id);
    
    if (index !== -1 && needsMigration(metas[index])) {
      // 提取文件名（相对路径）
      const fileName = metas[index].uri.split('/').pop();
      if (fileName) {
        metas[index].uri = fileName;
        await AsyncStorage.setItem(RECORDINGS_META_KEY, JSON.stringify(metas));
      }
    }
  } catch (error) {
    // 静默处理迁移错误
  }
}

// 删除录音
export async function deleteRecording(id: string): Promise<void> {
  try {
    const metas = await getRecordingsMeta();
    const meta = metas.find((r) => r.id === id);
    
    if (meta) {
      // Delete the audio file
      try {
        const file = getRecordingFile(meta);
        if (file.exists) {
          file.delete();
        }
      } catch (e) {
      }
      
      // 删除分贝数据
      await AsyncStorage.removeItem(getDecibelDataKey(id));

      // 删除高频分贝数据文件
      try {
        const fullRateFile = getFullRateFile(id);
        if (fullRateFile.exists) {
          fullRateFile.delete();
        }
      } catch (e) {
      }

      // 从元数据列表中移除
      const filtered = metas.filter((r) => r.id !== id);
      await AsyncStorage.setItem(RECORDINGS_META_KEY, JSON.stringify(filtered));
    }
  } catch (error) {
    throw error;
  }
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  
  const locale = getDateLocale();
  const todayLabel = i18n.t('common.today');
  const yesterdayLabel = i18n.t('common.yesterday');
  
  const timeStr = date.toLocaleTimeString(locale, { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  if (isToday) {
    return `${todayLabel} ${timeStr}`;
  } else if (isYesterday) {
    return `${yesterdayLabel} ${timeStr}`;
  } else {
    return date.toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 提醒设置存储键
const REMINDER_ENABLED_KEY = 'reminder_enabled';
const REMINDER_TIME_KEY = 'reminder_time';

// 默认提醒时间 (22:00)
export const DEFAULT_REMINDER_TIME = { hour: 22, minute: 0 };

export interface ReminderSettings {
  enabled: boolean;
  hour: number;
  minute: number;
}

// 保存提醒设置
export async function saveReminderSettings(settings: ReminderSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(REMINDER_ENABLED_KEY, settings.enabled.toString());
    await AsyncStorage.setItem(REMINDER_TIME_KEY, JSON.stringify({
      hour: settings.hour,
      minute: settings.minute,
    }));
  } catch (error) {
    throw error;
  }
}

// 获取提醒设置
export async function getReminderSettings(): Promise<ReminderSettings> {
  try {
    const enabledValue = await AsyncStorage.getItem(REMINDER_ENABLED_KEY);
    const timeValue = await AsyncStorage.getItem(REMINDER_TIME_KEY);
    
    let settings: ReminderSettings = {
      enabled: false,
      ...DEFAULT_REMINDER_TIME,
    };
    
    if (enabledValue !== null) {
      settings.enabled = enabledValue === 'true';
    }
    
    if (timeValue !== null) {
      try {
        const timeData = JSON.parse(timeValue);
        settings.hour = timeData.hour ?? DEFAULT_REMINDER_TIME.hour;
        settings.minute = timeData.minute ?? DEFAULT_REMINDER_TIME.minute;
      } catch (e) {
        // 解析失败使用默认值
      }
    }
    
    return settings;
  } catch (error) {
    return {
      enabled: false,
      ...DEFAULT_REMINDER_TIME,
    };
  }
}
