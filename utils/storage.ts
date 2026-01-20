import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

export interface Recording {
  id: string;
  uri: string;
  createdAt: number;
  duration: number; // in milliseconds
  analysis?: SnoreAnalysis;
}

export interface SnoreAnalysis {
  hasSnoring: boolean;
  snoreCount: number;
  snoreDuration: number; // total seconds of snoring
  severity: 'none' | 'mild' | 'moderate' | 'severe';
  analyzedAt: number;
}

const RECORDINGS_KEY = 'sleep_recordings';

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
    recordings.unshift(recording); // Add to the beginning
    await AsyncStorage.setItem(RECORDINGS_KEY, JSON.stringify(recordings));
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
        await FileSystem.deleteAsync(recording.uri, { idempotent: true });
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
