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

// 录音配置 - 压缩音频体积
// iOS 测试约 200-300KB/分钟，Android 类似
const RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 8000,        // 8000 Hz
  numberOfChannels: 1,     // 单声道
  bitRate: 16000,          // 16kbps
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    extension: '.m4a',
    outputFormat: 'aac ',
    audioQuality: 0,        // 最低音质
    sampleRate: 8000,
    bitDepthHint: 8,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 16000,
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

  // 将 metering 值转换为更准确的分贝显示
  // expo-audio 的 metering 返回 dBFS (decibels relative to full scale)
  // 范围大约是 -160 (静音) 到 0 (最大音量)
  // 
  // 真实世界的分贝参考：
  // - 10 dB: 呼吸声
  // - 20 dB: 耳语
  // - 30 dB: 安静的房间
  // - 40 dB: 安静的办公室
  // - 50 dB: 正常交谈
  // - 60 dB: 大声说话
  // - 70 dB: 吸尘器
  // - 80 dB: 闹市街道
  //
  // 打鼾通常在 40-70 dB 范围
  const meteringToDecibel = useCallback((metering: number | undefined): number => {
    if (metering === undefined || metering === null) return 0;
    
    // metering 值通常在 -160 到 0 之间
    // -160 dBFS 对应极安静 (~0 dB SPL)
    // -60 dBFS 对应安静房间 (~30 dB SPL)
    // -40 dBFS 对应正常说话 (~50 dB SPL)
    // -20 dBFS 对应大声说话 (~70 dB SPL)
    // 0 dBFS 对应最大音量 (~90 dB SPL)
    
    // 使用更合理的映射：
    // metering: -160 ~ 0 -> 实际显示: 0 ~ 90 dB
    // 但我们主要关心 -80 到 -10 这个范围（对应 20-80 dB）
    
    // 将 dBFS 转换为近似的 SPL 分贝值
    // 公式：SPL ≈ metering + 90 (简化映射)
    // 然后限制在合理范围内
    const spl = metering + 90;
    
    // 限制在 0-100 范围，但实际上 0-20 很少见
    const clampedSpl = Math.max(0, Math.min(100, spl));
    
    return Math.round(clampedSpl);
  }, []);

  // 使用 interval 主动获取 metering 数据
  const startMetering = useCallback(() => {
    meteringIntervalRef.current = setInterval(() => {
      if (isRecordingRef.current) {
        try {
          // getStatus() 返回 RecorderState，包含 metering 字段
          const status = recorder.getStatus();
          
          // status.metering 在 expo-audio 中是可选的
          // 注意：在 iOS 模拟器上可能无法获取真实的 metering 数据
          // 真实设备上应该能正常工作
          let decibel: number;
          const metering = status.metering;
          
          // 检查是否有有效的 metering 数据
          // metering 为 0 在安静环境下是不可能的（应该是负数），所以 0 表示数据无效
          if (metering !== undefined && metering !== null && metering < 0) {
            decibel = meteringToDecibel(metering);
          } else if (__DEV__) {
            // 在模拟器上 metering 可能不可用或始终为 0
            // 仅在开发环境生成模拟数据以便测试 UI
            // 模拟安静房间环境：25-40 dB，偶尔有打鼾 50-65 dB
            const baseDecibel = 25 + Math.random() * 15; // 25-40 dB 基础噪音
            // 10% 概率产生较高分贝（模拟打鼾）
            decibel = Math.random() < 0.1 ? 50 + Math.random() * 15 : baseDecibel;
            decibel = Math.round(decibel);
          } else {
            // 生产环境：metering 无效时设为 0
            decibel = 0;
          }
          
          const timestamp = Date.now() - startTimeRef.current;
          const isSnoring = decibel >= SNORE_THRESHOLD_DB;
          
          const dataPoint: DecibelDataPoint = {
            timestamp,
            decibel,
            isSnoring,
          };
          
          decibelDataRef.current.push(dataPoint);
          // 实时显示只展示最近10个数据点，但保留完整数据用于保存
          const displayData = decibelDataRef.current.slice(-10);
          setDecibelData([...displayData]);
          setCurrentDecibel(decibel);
        } catch (e) {
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
      
      // 先立即设置录音状态，让用户看到即时反馈
      const newId = generateId();
      recordingIdRef.current = newId;
      setRecordingId(newId);
      isRecordingRef.current = true;
      setIsRecording(true);
      
      // 重置其他状态
      decibelDataRef.current = [];
      setDecibelData([]);
      setCurrentDecibel(0);
      setDuration(0);
      durationRef.current = 0;
      startTimeRef.current = Date.now();
      
      // 请求权限（异步，不阻塞 UI）
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        setError('需要麦克风权限才能录音');
        isRecordingRef.current = false;
        setIsRecording(false);
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

      // 准备录音（这是必须的步骤）
      await recorder.prepareToRecordAsync();
      
      // 开始录音
      recorder.record();
      
      // 启动定时器
      startMetering();
      startDurationTimer();
      startPeriodicSave();
    } catch (err) {
      setError('无法开始录音: ' + (err as Error).message);
      isRecordingRef.current = false;
      setIsRecording(false);
    }
  }, [recorder, startMetering, startDurationTimer, startPeriodicSave]);

  // 停止录音
  const stopRecording = useCallback(async (): Promise<{ uri: string; decibelData: DecibelDataPoint[]; duration: number } | null> => {
    try {
      stopMetering();
      stopDurationTimer();
      stopPeriodicSave();

      // 检查是否正在录音
      if (!isRecordingRef.current) {
        return null;
      }

      const finalDuration = durationRef.current;
      const finalDecibelData = [...decibelDataRef.current];

      isRecordingRef.current = false;
      setIsRecording(false);

      // 停止录音
      await recorder.stop();

      const uri = recorder.uri;
      
      // 清理状态
      setCurrentDecibel(0);
      setDuration(0);
      setDecibelData([]);
      recordingIdRef.current = null;
      setRecordingId(null);

      if (uri) {
        return { uri, decibelData: finalDecibelData, duration: finalDuration };
      }
      
      return null;
    } catch (err) {
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
