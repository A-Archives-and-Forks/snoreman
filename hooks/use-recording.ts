import { useEffect, useRef, useState, useCallback } from 'react';
import { useAudioRecorder, AudioModule, RecordingOptions } from 'expo-audio';
import { AppState } from 'react-native';
import {
  DecibelDataPoint,
  generateId,
} from '@/utils/storage';
import { detectSnoreEvents } from '@/utils/snore-detection';
import { FULL_RATE_INTERVAL_MS } from '@/utils/decibel-codec';
import { showRecordingNotification, hideRecordingNotification } from '@/utils/recording-notification';

// 每250ms采样一次分贝：高频数据用于打鼾节律检测（呼噜间隔约2~10秒，1Hz太粗）
// 间隔必须与二进制编码的槽位间隔一致
const METERING_INTERVAL_MS = FULL_RATE_INTERVAL_MS;
// 实时自动检测的运行间隔
const LIVE_DETECTION_INTERVAL_MS = 20000;

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

export interface StopRecordingResult {
  uri: string;
  decibelData: DecibelDataPoint[];     // 每秒聚合数据（用于图表和存储）
  fullRateData: DecibelDataPoint[];    // 高频原始数据（用于打鼾自动分析，不落盘）
  duration: number;
}

export interface UseRecordingResult {
  isRecording: boolean;
  currentDecibel: number;
  decibelData: DecibelDataPoint[];
  duration: number;
  recordingId: string | null;
  liveSnoreCount: number;    // 实时自动识别到的呼噜次数
  isLikelySnoring: boolean;  // 最近是否正在打鼾（自动识别）
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<StopRecordingResult | null>;
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
  const [liveSnoreCount, setLiveSnoreCount] = useState(0);
  const [isLikelySnoring, setIsLikelySnoring] = useState(false);

  const startTimeRef = useRef<number>(0);
  const meteringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const decibelDataRef = useRef<DecibelDataPoint[]>([]);      // 每秒聚合（取每秒最大值）
  const fullRateDataRef = useRef<DecibelDataPoint[]>([]);     // 250ms 高频数据（仅内存）
  const detectionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingIdRef = useRef<string | null>(null);
  const isRecordingRef = useRef<boolean>(false);

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

    // 将 dBFS 转换为近似的 SPL 分贝值
    // 公式：SPL ≈ metering + 90 (简化映射)
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
          const timestamp = Date.now() - startTimeRef.current;

          // 检查是否有有效的 metering 数据
          // metering 为 0 在安静环境下是不可能的（应该是负数），所以 0 表示数据无效
          if (metering !== undefined && metering !== null && metering < 0) {
            decibel = meteringToDecibel(metering);
          } else if (__DEV__) {
            // 在模拟器上 metering 可能不可用或始终为 0
            // 仅在开发环境生成模拟数据以便测试 UI 和自动识别
            // 模拟打鼾节律：每分钟交替打鼾期/安静期，打鼾期内每4秒一次约1秒的呼噜
            const episodeActive = Math.floor(timestamp / 60000) % 2 === 0;
            const inBurst = timestamp % 4000 < 1100;
            decibel = episodeActive && inBurst
              ? Math.round(52 + Math.random() * 8)
              : Math.round(27 + Math.random() * 6);
          } else {
            // 生产环境：metering 无效时设为 0
            decibel = 0;
          }

          // 高频数据：用于打鼾自动识别（仅保存在内存）
          fullRateDataRef.current.push({ timestamp, decibel });

          // 每秒聚合数据：取每秒内的最大值（用于图表显示和落盘，保留呼噜峰值）
          const chartData = decibelDataRef.current;
          const second = Math.floor(timestamp / 1000);
          const lastPoint = chartData[chartData.length - 1];
          if (lastPoint && Math.floor(lastPoint.timestamp / 1000) === second) {
            if (decibel > lastPoint.decibel) {
              lastPoint.decibel = decibel;
            }
          } else {
            chartData.push({ timestamp: second * 1000, decibel });
          }

          // 实时显示只展示最近10个数据点，但保留完整数据用于保存
          // 息屏/后台时跳过 UI 更新，避免整晚无谓渲染（数据采集不受影响，
          // 回到前台后下一个采样周期即恢复刷新）
          if (AppState.currentState === 'active') {
            setDecibelData(chartData.slice(-10));
            setCurrentDecibel(decibel);
          }
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

  // 实时打鼾自动检测：定期对高频数据跑一次识别
  const startLiveDetection = useCallback(() => {
    detectionIntervalRef.current = setInterval(() => {
      if (!isRecordingRef.current) return;
      // 息屏/后台时跳过：结果只用于前台 UI，整夜后台空算浪费电（回前台后 20 秒内自然刷新）
      if (AppState.currentState !== 'active') return;
      try {
        const { events } = detectSnoreEvents(fullRateDataRef.current);
        setLiveSnoreCount(events.length);

        // 最近20秒内有识别到的呼噜则认为正在打鼾
        const nowTs = Date.now() - startTimeRef.current;
        const lastEvent = events[events.length - 1];
        setIsLikelySnoring(!!lastEvent && nowTs - lastEvent.endTime < 20000);
      } catch (e) {
      }
    }, LIVE_DETECTION_INTERVAL_MS);
  }, []);

  const stopLiveDetection = useCallback(() => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
  }, []);

  // 开始计时
  const startDurationTimer = useCallback(() => {
    durationIntervalRef.current = setInterval(() => {
      // 息屏/后台时跳过 UI 更新（同 metering；最终时长在停止时按墙钟计算）
      if (AppState.currentState === 'active') {
        setDuration(Date.now() - startTimeRef.current);
      }
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
      fullRateDataRef.current = [];
      setDecibelData([]);
      setCurrentDecibel(0);
      setDuration(0);
      setLiveSnoreCount(0);
      setIsLikelySnoring(false);
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
      startLiveDetection();

      // 锁屏/通知栏显示"正在录音"指示（静音，失败不影响录音）
      showRecordingNotification();
    } catch (err) {
      setError('无法开始录音: ' + (err as Error).message);
      isRecordingRef.current = false;
      setIsRecording(false);
    }
  }, [recorder, startMetering, startDurationTimer, startLiveDetection]);

  // 停止录音
  const stopRecording = useCallback(async (): Promise<StopRecordingResult | null> => {
    try {
      stopMetering();
      stopDurationTimer();
      stopLiveDetection();
      hideRecordingNotification();

      // 检查是否正在录音
      if (!isRecordingRef.current) {
        return null;
      }

      // 时长直接按墙钟算，不取计时器最后一次 tick 的值：
      // 整夜息屏时定时器/AppState 的行为不可靠，曾导致整晚录音只存下锁屏前的时长
      const finalDuration = Date.now() - startTimeRef.current;
      const finalDecibelData = [...decibelDataRef.current];
      const finalFullRateData = [...fullRateDataRef.current];

      isRecordingRef.current = false;
      setIsRecording(false);

      // 停止录音
      await recorder.stop();

      const uri = recorder.uri;

      // 清理状态
      setCurrentDecibel(0);
      setDuration(0);
      setDecibelData([]);
      setLiveSnoreCount(0);
      setIsLikelySnoring(false);
      fullRateDataRef.current = [];
      recordingIdRef.current = null;
      setRecordingId(null);

      if (uri) {
        return {
          uri,
          decibelData: finalDecibelData,
          fullRateData: finalFullRateData,
          duration: finalDuration,
        };
      }

      return null;
    } catch (err) {
      setError('无法停止录音: ' + (err as Error).message);
      isRecordingRef.current = false;
      setIsRecording(false);
      return null;
    }
  }, [recorder, stopMetering, stopDurationTimer, stopLiveDetection]);

  // 挂载时清理上次异常退出（如录音中被系统杀掉）残留的"正在录音"通知
  useEffect(() => {
    hideRecordingNotification();
  }, []);

  // 录音中每次切到后台就补发"正在录音"通知
  // iOS 上点通知进 app 会移除它（系统行为），重新锁屏/切后台时补回，保证锁屏一直有指示
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' && isRecordingRef.current) {
        showRecordingNotification();
      }
    });
    return () => sub.remove();
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      stopMetering();
      stopDurationTimer();
      stopLiveDetection();
    };
  }, [stopMetering, stopDurationTimer, stopLiveDetection]);

  return {
    isRecording,
    currentDecibel,
    decibelData,
    duration,
    recordingId,
    liveSnoreCount,
    isLikelySnoring,
    startRecording,
    stopRecording,
    error,
  };
}
