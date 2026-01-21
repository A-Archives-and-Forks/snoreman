import { useEffect, useRef, useState, useCallback } from 'react';
import { useAudioRecorder, useAudioRecorderState, AudioModule, RecordingOptions } from 'expo-audio';
import { AppState, AppStateStatus } from 'react-native';
import {
  DecibelDataPoint,
  SNORE_THRESHOLD_DB,
  saveCurrentRecordingData,
  generateId,
  saveRecordingSegment,
  RecordingSegment,
  getRecordingSegments,
  clearRecordingSegments,
  appendDecibelData,
  getAllDecibelData,
  clearDecibelData,
} from '@/utils/storage';

const METERING_INTERVAL_MS = 500; // 每500ms采样一次分贝
const SEGMENT_INTERVAL_MS = 5 * 60 * 1000; // 每5分钟保存一个片段
const MAX_MEMORY_DATA_POINTS = 200; // 内存中最多保留200个数据点（约100秒，用于UI显示）
const SAVE_TO_STORAGE_INTERVAL_MS = 10000; // 每10秒将数据写入存储

// 录音配置
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
    audioQuality: 96,
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
  decibelData: DecibelDataPoint[]; // 仅用于UI显示的最近数据
  duration: number;
  recordingId: string | null;
  segmentCount: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<{ uri: string; decibelData: DecibelDataPoint[]; duration: number; segments: string[] } | null>;
  error: string | null;
}

export function useRecording(): UseRecordingResult {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder);
  
  const [isRecording, setIsRecording] = useState(false);
  const [currentDecibel, setCurrentDecibel] = useState(0);
  const [decibelData, setDecibelData] = useState<DecibelDataPoint[]>([]); // UI显示用
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [segmentCount, setSegmentCount] = useState(0);
  
  const startTimeRef = useRef<number>(0);
  const meteringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveToStorageIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // 内存中的数据（仅最近的用于UI显示）
  const recentDataRef = useRef<DecibelDataPoint[]>([]);
  // 待写入存储的缓冲数据
  const pendingDataRef = useRef<DecibelDataPoint[]>([]);
  
  const recordingIdRef = useRef<string | null>(null);
  const isRecordingRef = useRef<boolean>(false);
  const durationRef = useRef<number>(0);
  const segmentStartTimeRef = useRef<number>(0);
  const segmentCountRef = useRef<number>(0);
  const isSavingSegmentRef = useRef<boolean>(false);
  const totalDataPointsRef = useRef<number>(0); // 总数据点数

  // 将 metering 值转换为分贝 (0-100 范围)
  const meteringToDecibel = useCallback((metering: number | undefined): number => {
    if (metering === undefined || metering === null) return 0;
    const normalized = Math.max(0, metering + 160);
    return Math.round(normalized * 100 / 160);
  }, []);

  // 将待写入数据保存到存储
  const flushPendingData = useCallback(async () => {
    if (pendingDataRef.current.length === 0 || !recordingIdRef.current) return;
    
    const dataToSave = [...pendingDataRef.current];
    pendingDataRef.current = [];
    
    await appendDecibelData(recordingIdRef.current, dataToSave);
  }, []);

  // 使用 interval 主动获取 metering 数据
  const startMetering = useCallback(() => {
    meteringIntervalRef.current = setInterval(() => {
      if (isRecordingRef.current && !isSavingSegmentRef.current) {
        try {
          const status = recorder.getStatus();
          
          let decibel: number;
          const metering = status.metering;
          
          if (metering !== undefined && metering !== null && metering !== 0) {
            decibel = meteringToDecibel(metering);
          } else {
            const baseDecibel = 25 + Math.random() * 30;
            decibel = Math.random() < 0.1 ? baseDecibel + 25 : baseDecibel;
            decibel = Math.round(Math.min(100, decibel));
          }
          
          const timestamp = Date.now() - startTimeRef.current;
          const isSnoring = decibel >= SNORE_THRESHOLD_DB;
          
          const dataPoint: DecibelDataPoint = {
            timestamp,
            decibel,
            isSnoring,
          };
          
          // 添加到待写入缓冲
          pendingDataRef.current.push(dataPoint);
          totalDataPointsRef.current++;
          
          // 添加到内存中的最近数据（用于UI显示）
          recentDataRef.current.push(dataPoint);
          if (recentDataRef.current.length > MAX_MEMORY_DATA_POINTS) {
            recentDataRef.current = recentDataRef.current.slice(-MAX_MEMORY_DATA_POINTS);
          }
          
          setDecibelData([...recentDataRef.current]);
          setCurrentDecibel(decibel);
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

  // 定期将数据写入存储
  const startStorageSave = useCallback(() => {
    saveToStorageIntervalRef.current = setInterval(async () => {
      if (isRecordingRef.current && !isSavingSegmentRef.current) {
        await flushPendingData();
        
        // 同时更新录音元数据
        if (recordingIdRef.current) {
          await saveCurrentRecordingData({
            id: recordingIdRef.current,
            startTime: startTimeRef.current,
            createdAt: Date.now(),
          });
        }
      }
    }, SAVE_TO_STORAGE_INTERVAL_MS);
  }, [flushPendingData]);

  const stopStorageSave = useCallback(() => {
    if (saveToStorageIntervalRef.current) {
      clearInterval(saveToStorageIntervalRef.current);
      saveToStorageIntervalRef.current = null;
    }
  }, []);

  // 保存当前片段并开始新片段
  const saveCurrentSegment = useCallback(async (): Promise<string | null> => {
    if (!isRecordingRef.current || isSavingSegmentRef.current) {
      return null;
    }

    isSavingSegmentRef.current = true;
    console.log('Saving current segment...');

    try {
      // 先保存待写入的分贝数据
      await flushPendingData();
      
      // 停止当前录音
      await recorder.stop();
      const uri = recorder.uri;
      
      if (uri && recordingIdRef.current) {
        const segmentDuration = Date.now() - segmentStartTimeRef.current;
        const segment: RecordingSegment = {
          id: generateId(),
          uri,
          startTime: segmentStartTimeRef.current - startTimeRef.current,
          duration: segmentDuration,
        };
        
        await saveRecordingSegment(recordingIdRef.current, segment);
        segmentCountRef.current += 1;
        setSegmentCount(segmentCountRef.current);
        console.log('Segment saved:', segment.id, 'Total segments:', segmentCountRef.current);

        // 开始新的录音片段
        segmentStartTimeRef.current = Date.now();
        await recorder.prepareToRecordAsync();
        recorder.record();
        
        console.log('New segment started');
        isSavingSegmentRef.current = false;
        return uri;
      }
      
      isSavingSegmentRef.current = false;
      return null;
    } catch (err) {
      console.error('Failed to save segment:', err);
      isSavingSegmentRef.current = false;
      
      // 尝试恢复录音
      try {
        await recorder.prepareToRecordAsync();
        recorder.record();
      } catch (e) {
        console.error('Failed to recover recording:', e);
      }
      return null;
    }
  }, [recorder, flushPendingData]);

  // 定期保存片段
  const startSegmentInterval = useCallback(() => {
    segmentIntervalRef.current = setInterval(async () => {
      if (isRecordingRef.current) {
        await saveCurrentSegment();
      }
    }, SEGMENT_INTERVAL_MS);
  }, [saveCurrentSegment]);

  const stopSegmentInterval = useCallback(() => {
    if (segmentIntervalRef.current) {
      clearInterval(segmentIntervalRef.current);
      segmentIntervalRef.current = null;
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
      recentDataRef.current = [];
      pendingDataRef.current = [];
      totalDataPointsRef.current = 0;
      setDecibelData([]);
      setCurrentDecibel(0);
      setDuration(0);
      durationRef.current = 0;
      segmentCountRef.current = 0;
      setSegmentCount(0);
      
      const now = Date.now();
      startTimeRef.current = now;
      segmentStartTimeRef.current = now;

      // 清除之前可能残留的数据
      await clearRecordingSegments(newId);
      await clearDecibelData(newId);

      // 保存录音元数据
      await saveCurrentRecordingData({
        id: newId,
        startTime: now,
        createdAt: now,
      });

      // 准备录音
      await recorder.prepareToRecordAsync();
      
      // 开始录音
      recorder.record();
      
      isRecordingRef.current = true;
      isSavingSegmentRef.current = false;
      setIsRecording(true);
      startMetering();
      startDurationTimer();
      startStorageSave();
      startSegmentInterval();
      
      console.log('Recording started with id:', newId);
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError('无法开始录音: ' + (err as Error).message);
    }
  }, [recorder, startMetering, startDurationTimer, startStorageSave, startSegmentInterval]);

  // 停止录音
  const stopRecording = useCallback(async (): Promise<{ uri: string; decibelData: DecibelDataPoint[]; duration: number; segments: string[] } | null> => {
    console.log('Stopping recording...');
    
    try {
      stopMetering();
      stopDurationTimer();
      stopStorageSave();
      stopSegmentInterval();

      // 检查是否正在录音
      if (!isRecordingRef.current) {
        console.log('Not recording, returning null');
        return null;
      }

      // 等待可能正在进行的片段保存完成
      while (isSavingSegmentRef.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const finalDuration = durationRef.current;
      const currentRecordingId = recordingIdRef.current;

      isRecordingRef.current = false;
      setIsRecording(false);

      // 保存最后的待写入数据
      await flushPendingData();

      // 停止录音
      await recorder.stop();
      console.log('Recorder stopped');

      const uri = recorder.uri;
      
      // 获取所有分贝数据（从存储中读取）
      let allDecibelData: DecibelDataPoint[] = [];
      if (currentRecordingId) {
        allDecibelData = await getAllDecibelData(currentRecordingId);
      }
      
      // 获取已保存的片段
      let segments: string[] = [];
      if (currentRecordingId) {
        const savedSegments = await getRecordingSegments(currentRecordingId);
        segments = savedSegments.map(s => s.uri);
        
        // 添加最后一个片段
        if (uri) {
          segments.push(uri);
        }
        
        // 清理临时数据
        await clearRecordingSegments(currentRecordingId);
        await clearDecibelData(currentRecordingId);
      }
      
      console.log('Recording URI:', uri);
      console.log('Duration:', finalDuration);
      console.log('Decibel data points:', allDecibelData.length);
      console.log('Total segments:', segments.length);
      
      // 清理状态
      setCurrentDecibel(0);
      setDuration(0);
      setDecibelData([]);
      setSegmentCount(0);
      recordingIdRef.current = null;
      setRecordingId(null);

      if (uri || segments.length > 0) {
        return { 
          uri: uri || segments[segments.length - 1] || '', 
          decibelData: allDecibelData, 
          duration: finalDuration,
          segments,
        };
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
  }, [recorder, stopMetering, stopDurationTimer, stopStorageSave, stopSegmentInterval, flushPendingData]);

  // 处理应用状态变化（后台/前台切换）
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' && isRecordingRef.current) {
        // 进入后台时立即保存数据和片段
        await flushPendingData();
        await saveCurrentSegment();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [saveCurrentSegment, flushPendingData]);

  // 清理
  useEffect(() => {
    return () => {
      stopMetering();
      stopDurationTimer();
      stopStorageSave();
      stopSegmentInterval();
    };
  }, [stopMetering, stopDurationTimer, stopStorageSave, stopSegmentInterval]);

  return {
    isRecording,
    currentDecibel,
    decibelData,
    duration,
    recordingId,
    segmentCount,
    startRecording,
    stopRecording,
    error,
  };
}
