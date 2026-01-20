import { useEffect, useRef, useState, useCallback } from 'react';
import { useAudioRecorder, AudioModule, RecordingOptions } from 'expo-audio';
import { AppState, AppStateStatus } from 'react-native';
import {
  DecibelDataPoint,
  SNORE_THRESHOLD_DB,
  saveCurrentRecordingData,
  generateId,
} from '@/utils/storage';

const METERING_INTERVAL_MS = 500; // 每500ms采样一次分贝

// 录音配置 - 优化后台录音
const RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 128000,
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    extension: '.m4a',
    audioQuality: 96, // max quality
    sampleRate: 44100,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 128000,
  },
};

export interface UseRecordingResult {
  isRecording: boolean;
  currentDecibel: number;
  decibelData: DecibelDataPoint[];
  duration: number;
  recordingId: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<{ uri: string; decibelData: DecibelDataPoint[] } | null>;
  error: string | null;
}

export function useRecording(): UseRecordingResult {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const [isRecording, setIsRecording] = useState(false);
  const [currentDecibel, setCurrentDecibel] = useState(0);
  const [decibelData, setDecibelData] = useState<DecibelDataPoint[]>([]);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  
  const startTimeRef = useRef<number>(0);
  const meteringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const decibelDataRef = useRef<DecibelDataPoint[]>([]);
  const saveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingIdRef = useRef<string | null>(null);

  // 将 metering 值转换为分贝 (0-100 范围)
  const meteringToDecibel = useCallback((metering: number | undefined): number => {
    if (metering === undefined) return 0;
    // expo-audio 的 metering 值通常在 -160 到 0 之间
    // -160 表示静音，0 表示最大音量
    // 转换为 0-100 的分贝范围
    const normalized = Math.max(0, metering + 160);
    return Math.round(normalized * 100 / 160);
  }, []);

  // 定期保存数据到 AsyncStorage（防止数据丢失）
  const startPeriodicSave = useCallback(() => {
    saveIntervalRef.current = setInterval(async () => {
      if (recordingIdRef.current && decibelDataRef.current.length > 0) {
        await saveCurrentRecordingData({
          id: recordingIdRef.current,
          startTime: startTimeRef.current,
          decibelData: decibelDataRef.current,
        });
      }
    }, 5000); // 每5秒保存一次
  }, []);

  const stopPeriodicSave = useCallback(() => {
    if (saveIntervalRef.current) {
      clearInterval(saveIntervalRef.current);
      saveIntervalRef.current = null;
    }
  }, []);

  // 开始分贝监测
  const startMetering = useCallback(() => {
    meteringIntervalRef.current = setInterval(() => {
      if (recorder.isRecording) {
        const status = recorder.getStatus();
        const decibel = meteringToDecibel(status.metering);
        const timestamp = Date.now() - startTimeRef.current;
        const isSnoring = decibel >= SNORE_THRESHOLD_DB;
        
        const dataPoint: DecibelDataPoint = {
          timestamp,
          decibel,
          isSnoring,
        };
        
        decibelDataRef.current.push(dataPoint);
        setDecibelData([...decibelDataRef.current]);
        setCurrentDecibel(decibel);
      }
    }, METERING_INTERVAL_MS);
  }, [recorder, meteringToDecibel]);

  const stopMetering = useCallback(() => {
    if (meteringIntervalRef.current) {
      clearInterval(meteringIntervalRef.current);
      meteringIntervalRef.current = null;
    }
  }, []);

  // 开始计时
  const startDurationTimer = useCallback(() => {
    durationIntervalRef.current = setInterval(() => {
      setDuration(Date.now() - startTimeRef.current);
    }, 1000);
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  // 开始录音
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      
      // 请求权限
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        setError('需要麦克风权限才能录音');
        return;
      }

      // 配置音频模式（允许后台录音）
      await AudioModule.setAudioModeAsync({
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
        shouldPlayInBackground: true,
        allowsRecording: true,
        allowsBackgroundRecording: true,
        interruptionMode: 'doNotMix',
      });

      // 重置状态
      const newId = generateId();
      recordingIdRef.current = newId;
      setRecordingId(newId);
      decibelDataRef.current = [];
      setDecibelData([]);
      setCurrentDecibel(0);
      setDuration(0);
      startTimeRef.current = Date.now();

      // 开始录音
      await recorder.record();
      
      setIsRecording(true);
      startMetering();
      startDurationTimer();
      startPeriodicSave();
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError('无法开始录音');
    }
  }, [recorder, startMetering, startDurationTimer, startPeriodicSave]);

  // 停止录音
  const stopRecording = useCallback(async () => {
    try {
      stopMetering();
      stopDurationTimer();
      stopPeriodicSave();

      if (!recorder.isRecording) {
        return null;
      }

      await recorder.stop();
      setIsRecording(false);

      const uri = recorder.uri;
      const finalDecibelData = [...decibelDataRef.current];
      
      // 清理
      setCurrentDecibel(0);
      recordingIdRef.current = null;
      setRecordingId(null);

      if (uri) {
        return { uri, decibelData: finalDecibelData };
      }
      return null;
    } catch (err) {
      console.error('Failed to stop recording:', err);
      setError('无法停止录音');
      return null;
    }
  }, [recorder, stopMetering, stopDurationTimer, stopPeriodicSave]);

  // 处理应用状态变化（后台/前台切换）
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      // 应用切换到后台时，确保录音继续并保存数据
      if (nextAppState === 'background' && recorder.isRecording) {
        // 立即保存当前数据
        if (recordingIdRef.current && decibelDataRef.current.length > 0) {
          saveCurrentRecordingData({
            id: recordingIdRef.current,
            startTime: startTimeRef.current,
            decibelData: decibelDataRef.current,
          });
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [recorder]);

  // 清理
  useEffect(() => {
    return () => {
      stopMetering();
      stopDurationTimer();
      stopPeriodicSave();
    };
  }, [stopMetering, stopDurationTimer, stopPeriodicSave]);

  return {
    isRecording,
    currentDecibel,
    decibelData,
    duration,
    recordingId,
    startRecording,
    stopRecording,
    error,
  };
}
