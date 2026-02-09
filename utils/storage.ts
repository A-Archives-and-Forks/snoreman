import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import i18n from '@/i18n';

// 分贝数据点 - 每秒一个采样点
export interface DecibelDataPoint {
  timestamp: number; // 相对于录音开始的毫秒数
  decibel: number;   // 分贝值 (0-120)
  isSnoring: boolean; // 是否被识别为打鼾
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
}

export interface SnoreEvent {
  startTime: number;  // 开始时间（毫秒）
  endTime: number;    // 结束时间（毫秒）
  maxDecibel: number; // 该事件最大分贝
}

// 打鼾检测阈值 (分贝)
export const SNORE_THRESHOLD_DB = 45;
// 最小打鼾持续时间 (毫秒)
export const MIN_SNORE_DURATION_MS = 1000;

const RECORDINGS_META_KEY = 'sleep_recordings_meta'; // 只存元数据
const RECORDINGS_KEY = 'sleep_recordings'; // 旧版兼容
const CURRENT_RECORDING_KEY = 'current_recording_data';
const SNORE_THRESHOLD_KEY = 'snore_threshold';

// 获取分贝数据的存储 key
function getDecibelDataKey(id: string): string {
  return `decibel_data_${id}`;
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

// 兼容旧 API：获取所有录音（含分贝数据）- 尽量避免使用
export async function getRecordings(): Promise<Recording[]> {
  const metas = await getRecordingsMeta();
  const recordings: Recording[] = [];
  
  for (const meta of metas) {
    const decibelData = await getDecibelData(meta.id);
    recordings.push({
      ...meta,
      decibelData: decibelData || [],
    });
  }
  
  return recordings;
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
export async function saveRecording(recording: Recording): Promise<void> {
  try {
    // 1. 保存分贝数据到单独的 key
    if (recording.decibelData && recording.decibelData.length > 0) {
      await AsyncStorage.setItem(
        getDecibelDataKey(recording.id),
        JSON.stringify(recording.decibelData)
      );
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
    
    // 清除临时录音数据
    await AsyncStorage.removeItem(CURRENT_RECORDING_KEY);
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
      
      // 从元数据列表中移除
      const filtered = metas.filter((r) => r.id !== id);
      await AsyncStorage.setItem(RECORDINGS_META_KEY, JSON.stringify(filtered));
    }
  } catch (error) {
    throw error;
  }
}

// 临时保存录音中的分贝数据（防止应用被杀时数据丢失）
export async function saveCurrentRecordingData(data: {
  id: string;
  startTime: number;
  decibelData: DecibelDataPoint[];
}): Promise<void> {
  try {
    await AsyncStorage.setItem(CURRENT_RECORDING_KEY, JSON.stringify(data));
  } catch (error) {
  }
}

export async function getCurrentRecordingData(): Promise<{
  id: string;
  startTime: number;
  decibelData: DecibelDataPoint[];
} | null> {
  try {
    const data = await AsyncStorage.getItem(CURRENT_RECORDING_KEY);
    if (data) {
      return JSON.parse(data);
    }
    return null;
  } catch (error) {
    return null;
  }
}

export async function clearCurrentRecordingData(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CURRENT_RECORDING_KEY);
  } catch (error) {
  }
}

// 分析分贝数据，识别打鼾事件
export function analyzeDecibelData(decibelData: DecibelDataPoint[], threshold: number = SNORE_THRESHOLD_DB): SnoreAnalysis {
  if (decibelData.length === 0) {
    return {
      hasSnoring: false,
      snoreCount: 0,
      snoreDuration: 0,
      maxDecibel: 0,
      avgDecibel: 0,
      avgSnoringDecibel: 0,
      severity: 'none',
      analyzedAt: Date.now(),
      snoreEvents: [],
    };
  }

  // 计算基本统计数据
  const decibels = decibelData.map(d => d.decibel);
  const maxDecibel = Math.max(...decibels);
  const avgDecibel = decibels.reduce((a, b) => a + b, 0) / decibels.length;

  // 识别打鼾事件（使用传入的阈值）
  const snoreEvents: SnoreEvent[] = [];
  let currentEvent: { startTime: number; maxDecibel: number } | null = null;

  for (const point of decibelData) {
    const isAboveThreshold = point.decibel >= threshold;
    if (isAboveThreshold) {
      if (!currentEvent) {
        currentEvent = { startTime: point.timestamp, maxDecibel: point.decibel };
      } else {
        currentEvent.maxDecibel = Math.max(currentEvent.maxDecibel, point.decibel);
      }
    } else {
      if (currentEvent) {
        const duration = point.timestamp - currentEvent.startTime;
        if (duration >= MIN_SNORE_DURATION_MS) {
          snoreEvents.push({
            startTime: currentEvent.startTime,
            endTime: point.timestamp,
            maxDecibel: currentEvent.maxDecibel,
          });
        }
        currentEvent = null;
      }
    }
  }

  // 处理最后一个事件
  if (currentEvent && decibelData.length > 0) {
    const lastPoint = decibelData[decibelData.length - 1];
    const duration = lastPoint.timestamp - currentEvent.startTime;
    if (duration >= MIN_SNORE_DURATION_MS) {
      snoreEvents.push({
        startTime: currentEvent.startTime,
        endTime: lastPoint.timestamp,
        maxDecibel: currentEvent.maxDecibel,
      });
    }
  }

  // 计算打鼾统计（使用传入的阈值）
  const snoreDuration = snoreEvents.reduce((acc, event) => acc + (event.endTime - event.startTime), 0) / 1000;
  const snoringPoints = decibelData.filter(d => d.decibel >= threshold);
  const avgSnoringDecibel = snoringPoints.length > 0
    ? snoringPoints.reduce((a, b) => a + b.decibel, 0) / snoringPoints.length
    : 0;

  // 判断严重程度
  let severity: SnoreAnalysis['severity'] = 'none';
  if (snoreEvents.length > 0) {
    const totalDurationMin = (decibelData[decibelData.length - 1]?.timestamp || 0) / 60000;
    const snorePercentage = totalDurationMin > 0 ? (snoreDuration / 60) / totalDurationMin * 100 : 0;
    
    if (snorePercentage > 30 || snoreEvents.length > 50) {
      severity = 'severe';
    } else if (snorePercentage > 15 || snoreEvents.length > 25) {
      severity = 'moderate';
    } else {
      severity = 'mild';
    }
  }

  return {
    hasSnoring: snoreEvents.length > 0,
    snoreCount: snoreEvents.length,
    snoreDuration: Math.round(snoreDuration),
    maxDecibel: Math.round(maxDecibel),
    avgDecibel: Math.round(avgDecibel),
    avgSnoringDecibel: Math.round(avgSnoringDecibel),
    severity,
    analyzedAt: Date.now(),
    snoreEvents,
  };
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
  
  const locale = i18n.locale === 'zh' ? 'zh-CN' : 'en-US';
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

// 保存打鼾阈值设置
export async function saveSnoreThreshold(threshold: number): Promise<void> {
  try {
    await AsyncStorage.setItem(SNORE_THRESHOLD_KEY, threshold.toString());
  } catch (error) {
  }
}

// 获取打鼾阈值设置
export async function getSnoreThreshold(): Promise<number> {
  try {
    const value = await AsyncStorage.getItem(SNORE_THRESHOLD_KEY);
    if (value !== null) {
      const threshold = parseInt(value, 10);
      if (!isNaN(threshold)) {
        return threshold;
      }
    }
    return SNORE_THRESHOLD_DB; // 返回默认值
  } catch (error) {
    return SNORE_THRESHOLD_DB;
  }
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
