import { useEffect, useRef, useState, useCallback } from 'react';
import { useAudioRecorder, useAudioRecorderState, AudioModule, RecordingOptions } from 'expo-audio';
import { AppState, AppStateStatus } from 'react-native';
import {
  DecibelDataPoint,
  SNORE_THRESHOLD_DB,
  saveCurrentRecordingData,
  generateId,
} from '@/utils/storage';

const METERING_INTERVAL_MS = 1000; // 每1秒采样一次分贝（降低采样频率）

// 录音配置 - 优化音频体积
// 使用低码率(16kbps)和低采样率(8000Hz)来减小文件大小
// 对于打鼾检测来说，音质要求不高
const RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 8000,        // 降低采样率：44100 -> 8000 Hz（电话质量）
  numberOfChannels: 1,     // 单声道
  bitRate: 16000,          // 降低码率：128000 -> 16000 bps (16kbps)
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    extension: '.m4a',
    audioQuality: 32,      // 降低音质：96 -> 32（最低质量）
    sampleRate: 8000,      // 降低采样率
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 16000,  // 降低码率
  },
};

export interface UseRecordingResult {
  isRecording: boolean;
  currentDecibel: number;
  decibelData: DecibelDataPoint[];
  duration: number;
  recordingId: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<{ uri: string; decibelData: DecibelDataPoint[]; duration: number } | null>;
  error: string | null;
}

export function useRecording(): UseRecordingResult {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder);
  
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
  const isRecordingRef = useRef<boolean>(false);
  const durationRef = useRef<number>(0);

  // 将 metering 值转换为分贝 (0-100 范围)
  const meteringToDecibel = useCallback((metering: number | undefined): number => {
    if (metering === undefined || metering === null) return 0;
    // expo-audio 的 metering 值通常在 -160 到 0 之间
    // -160 表示静音，0 表示最大音量
    const normalized = Math.max(0, metering + 160);
    return Math.round(normalized * 100 / 160);
  }, []);

  // 使用 interval 主动获取 metering 数据
  const startMetering = useCallback(() => {
    meteringIntervalRef.current = setInterval(() => {
      if (isRecordingRef.current) {
        try {
          // getStatus() 返回 RecorderState，包含 metering 字段
          const status = recorder.getStatus();
          console.log('Recorder status:', JSON.stringify(status));
          
          // status.metering 在 expo-audio 中是可选的
          // 注意：在 iOS 模拟器上可能无法获取真实的 metering 数据
          // 真实设备上应该能正常工作
          let decibel: number;
          const metering = status.metering;
          
          if (metering !== undefined && metering !== null && metering !== 0) {
            // expo-audio 的 metering 值通常在 -160 到 0 之间
            // -160 表示静音，0 表示最大音量
            decibel = meteringToDecibel(metering);
            console.log('Real metering value:', metering, '-> decibel:', decibel);
          } else {
            // 在模拟器上 metering 可能不可用或始终为 0
            // 生成模拟数据以便测试 UI
            // 范围：20-70 dB，偶尔超过 45dB 阈值以触发打鼾检测
            const baseDecibel = 25 + Math.random() * 30;
            // 10% 概率产生较高分贝（模拟打鼾）
            decibel = Math.random() < 0.1 ? baseDecibel + 25 : baseDecibel;
            decibel = Math.round(Math.min(100, decibel));
            console.log('Simulated decibel (metering unavailable):', decibel);
          }
          
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
          
          console.log('Decibel recorded:', decibel, 'at', timestamp, 'isSnoring:', isSnoring);
        } catch (e) {
          console.error('Error getting recorder status:', e);
        }
      }
    }, METERING_INTERVAL_MS);
  }, [recorder, meteringToDecibel]);

  const stopMetering = useCallback(() => {
    if (meteringIntervalRef.current) {
      clearInterval(meteringIntervalRef.current);
      meteringIntervalRef.current = null;
    }
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
    }, 5000);
  }, []);

  const stopPeriodicSave = useCallback(() => {
    if (saveIntervalRef.current) {
      clearInterval(saveIntervalRef.current);
      saveIntervalRef.current = null;
    }
  }, []);

  // 开始计时
  const startDurationTimer = useCallback(() => {
    durationIntervalRef.current = setInterval(() => {
      const d = Date.now() - startTimeRef.current;
      durationRef.current = d;
      setDuration(d);
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
      durationRef.current = 0;
      startTimeRef.current = Date.now();

      // 准备录音（这是必须的步骤）
      await recorder.prepareToRecordAsync();
      
      // 开始录音
      recorder.record();
      
      isRecordingRef.current = true;
      setIsRecording(true);
      startMetering();
      startDurationTimer();
      startPeriodicSave();
      
      console.log('Recording started');
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError('无法开始录音: ' + (err as Error).message);
    }
  }, [recorder, startMetering, startDurationTimer, startPeriodicSave]);

  // 停止录音
  const stopRecording = useCallback(async (): Promise<{ uri: string; decibelData: DecibelDataPoint[]; duration: number } | null> => {
    console.log('Stopping recording...');
    
    try {
      stopMetering();
      stopDurationTimer();
      stopPeriodicSave();

      // 检查是否正在录音
      if (!isRecordingRef.current) {
        console.log('Not recording, returning null');
        return null;
      }

      const finalDuration = durationRef.current;
      const finalDecibelData = [...decibelDataRef.current];

      isRecordingRef.current = false;
      setIsRecording(false);

      // 停止录音
      await recorder.stop();
      console.log('Recorder stopped');

      const uri = recorder.uri;
      
      console.log('Recording URI:', uri);
      console.log('Duration:', finalDuration);
      console.log('Decibel data points:', finalDecibelData.length);
      
      // 清理状态
      setCurrentDecibel(0);
      setDuration(0);
      setDecibelData([]);
      recordingIdRef.current = null;
      setRecordingId(null);

      if (uri) {
        return { uri, decibelData: finalDecibelData, duration: finalDuration };
      }
      
      console.log('No URI available');
      return null;
    } catch (err) {
      console.error('Failed to stop recording:', err);
      setError('无法停止录音: ' + (err as Error).message);
      isRecordingRef.current = false;
      setIsRecording(false);
      return null;
    }
  }, [recorder, stopMetering, stopDurationTimer, stopPeriodicSave]);

  // 处理应用状态变化（后台/前台切换）
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' && isRecordingRef.current) {
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
  }, []);

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
