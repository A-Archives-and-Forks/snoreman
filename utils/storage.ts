import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';

// 分贝数据点 - 每秒一个采样点
export interface DecibelDataPoint {
  timestamp: number; // 相对于录音开始的毫秒数
  decibel: number;   // 分贝值 (0-120)
  isSnoring: boolean; // 是否被识别为打鼾
}

export interface Recording {
  id: string;
  uri: string;
  createdAt: number;
  duration: number; // in milliseconds
  decibelData: DecibelDataPoint[]; // 分贝数据
  analysis?: SnoreAnalysis;
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

const RECORDINGS_KEY = 'sleep_recordings';
const CURRENT_RECORDING_KEY = 'current_recording_data';

export async function getRecordings(): Promise<Recording[]> {
  try {
    const data = await AsyncStorage.getItem(RECORDINGS_KEY);
    if (data) {
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Failed to get recordings:', error);
    return [];
  }
}

export async function saveRecording(recording: Recording): Promise<void> {
  try {
    const recordings = await getRecordings();
    recordings.unshift(recording);
    await AsyncStorage.setItem(RECORDINGS_KEY, JSON.stringify(recordings));
    // 清除临时录音数据
    await AsyncStorage.removeItem(CURRENT_RECORDING_KEY);
  } catch (error) {
    console.error('Failed to save recording:', error);
    throw error;
  }
}

export async function getRecording(id: string): Promise<Recording | null> {
  try {
    const recordings = await getRecordings();
    return recordings.find((r) => r.id === id) || null;
  } catch (error) {
    console.error('Failed to get recording:', error);
    return null;
  }
}

export async function updateRecording(id: string, updates: Partial<Recording>): Promise<void> {
  try {
    const recordings = await getRecordings();
    const index = recordings.findIndex((r) => r.id === id);
    if (index !== -1) {
      recordings[index] = { ...recordings[index], ...updates };
      await AsyncStorage.setItem(RECORDINGS_KEY, JSON.stringify(recordings));
    }
  } catch (error) {
    console.error('Failed to update recording:', error);
    throw error;
  }
}

export async function deleteRecording(id: string): Promise<void> {
  try {
    const recordings = await getRecordings();
    const recording = recordings.find((r) => r.id === id);
    
    if (recording) {
      // Delete the audio file
      try {
        const file = new File(recording.uri);
        if (file.exists) {
          file.delete();
        }
      } catch (e) {
        console.warn('Failed to delete audio file:', e);
      }
      
      // Remove from storage
      const filtered = recordings.filter((r) => r.id !== id);
      await AsyncStorage.setItem(RECORDINGS_KEY, JSON.stringify(filtered));
    }
  } catch (error) {
    console.error('Failed to delete recording:', error);
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
    console.error('Failed to save current recording data:', error);
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
    console.error('Failed to get current recording data:', error);
    return null;
  }
}

export async function clearCurrentRecordingData(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CURRENT_RECORDING_KEY);
  } catch (error) {
    console.error('Failed to clear current recording data:', error);
  }
}

// 分析分贝数据，识别打鼾事件
export function analyzeDecibelData(decibelData: DecibelDataPoint[]): SnoreAnalysis {
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

  // 识别打鼾事件
  const snoreEvents: SnoreEvent[] = [];
  let currentEvent: { startTime: number; maxDecibel: number } | null = null;

  for (const point of decibelData) {
    if (point.isSnoring) {
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

  // 计算打鼾统计
  const snoreDuration = snoreEvents.reduce((acc, event) => acc + (event.endTime - event.startTime), 0) / 1000;
  const snoringPoints = decibelData.filter(d => d.isSnoring);
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
  
  const timeStr = date.toLocaleTimeString('zh-CN', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  if (isToday) {
    return `今天 ${timeStr}`;
  } else if (isYesterday) {
    return `昨天 ${timeStr}`;
  } else {
    return date.toLocaleDateString('zh-CN', {
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
