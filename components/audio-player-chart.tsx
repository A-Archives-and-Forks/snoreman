import React, { useMemo, useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  LayoutChangeEvent,
  GestureResponderEvent,
  PanResponder,
} from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { DecibelDataPoint, SnoreEvent } from '@/utils/storage';
import { useTheme } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { Paths } from 'expo-file-system';
import { ThemedText } from '@/components/themed-text';
import { Ionicons, AntDesign } from '@expo/vector-icons';

// 15秒跳转按钮组件
interface SkipButtonProps {
  direction: 'backward' | 'forward';
  onPress: () => void;
  size?: number;
}

function SkipButton({ direction, onPress, size = 48 }: SkipButtonProps) {
  const { colors, isDark } = useTheme();
  const iconColor = isDark ? '#FFFFFF' : colors.brand;
  const bgColor = colors.brandSoft;

  return (
    <TouchableOpacity
      style={[styles.skipButton, { width: size, height: size, backgroundColor: bgColor }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.skipButtonContent}>
        <AntDesign
          name={direction === 'backward' ? 'reload' : 'reload'}
          size={28}
          color={iconColor}
          style={{
            transform: [{ scaleX: direction === 'backward' ? -1 : 1 }],
          }}
        />
        <ThemedText style={[styles.skipButtonText, { color: iconColor }]}>
          15
        </ThemedText>
      </View>
    </TouchableOpacity>
  );
}

export interface AudioPlayerChartHandle {
  // 跳转到指定位置并开始播放（毫秒）
  // 传入 stopAtMs 时播放到该位置自动暂停（用户手动操作播放器会取消自动暂停）
  seekToAndPlay: (positionMs: number, stopAtMs?: number) => void;
  // 暂停播放（供外部控件使用，如打鼾片段列表的暂停按钮）
  pause: () => void;
}

interface AudioPlayerChartProps {
  uri: string;
  data: DecibelDataPoint[];
  duration: number; // 总时长（毫秒）
  threshold?: number;
  height?: number; // 波形图区域高度
  onThresholdChange?: (value: number) => void;
  // auto: 按自动识别的打鼾事件着色，隐藏阈值线和阈值滑块
  // manual: 按阈值着色（旧行为）
  mode?: 'auto' | 'manual';
  snoreEvents?: SnoreEvent[]; // 自动识别的打鼾事件（auto 模式使用）
  startTime?: number; // 录音开始的时间戳（用于横轴显示当地时钟时间）
  // 播放状态回调（是否在播放 + 当前位置毫秒），供父级高亮正在播放的打鼾片段
  onPlaybackState?: (playing: boolean, positionMs: number) => void;
}

const DEFAULT_HEIGHT = 180;
const THRESHOLD_SLIDER_WIDTH = 22; // 右侧阈值滑块列宽度（含触摸区域）
const THRESHOLD_THUMB_SIZE = 14;
const SCRUBBER_HEIGHT = 28; // 进度条区域高度
const SCRUBBER_THUMB_SIZE = 14;
const BAR_WIDTH = 1; // 波形条宽度
const BAR_GAP = 0;   // 波形条间距（0 = 紧密填充，条数 = 图表宽度/条宽，约等于像素上限）

// 格式化为时间（时:分:秒）
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export const AudioPlayerChart = forwardRef<AudioPlayerChartHandle, AudioPlayerChartProps>(
  function AudioPlayerChart(
    {
      uri,
      data,
      duration,
      threshold = 45,
      height = DEFAULT_HEIGHT,
      onThresholdChange,
      mode = 'manual',
      snoreEvents = [],
      startTime,
      onPlaybackState,
    },
    ref
  ) {
  const { colors, isDark } = useTheme();

  // 播放器
  // uri 是相对路径（文件名），需要拼接完整路径
  // Paths.document 是 Directory 对象，需要使用 .uri 属性
  const audioUri = uri ? Paths.document.uri + uri : null;
  const player = useAudioPlayer(audioUri ? { uri: audioUri } : null);
  const status = useAudioPlayerStatus(player);

  const [isSliding, setIsSliding] = useState(false);
  const [sliderValue, setSliderValue] = useState<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(300);
  const [localThreshold, setLocalThreshold] = useState<number>(threshold);
  // 自动暂停点：seekTo 后 status.currentTime 是异步更新的，直接比较会拿到跳转前的
  // 旧位置——点一个更早的片段时旧位置已超过新暂停点，会被立即误暂停。
  // 所以暂停点需要"武装"：先观察到播放位置进入 [fromMs, stopAtMs) 窗口才生效
  const stopAtRef = useRef<{ fromMs: number; stopAtMs: number; armed: boolean } | null>(null);

  // 录音保存的阈值是异步加载的，prop 变化时同步内部状态
  useEffect(() => {
    setLocalThreshold(threshold);
  }, [threshold]);

  // 图表区域尺寸（手动模式需减去右侧阈值滑块宽度）
  const chartWidth = mode === 'manual' ? containerWidth - THRESHOLD_SLIDER_WIDTH : containerWidth;
  const chartHeight = height;

  // 获取容器宽度
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setContainerWidth(width);
  }, []);

  // 使用 duration 作为最大时间
  const maxTime = duration || (data.length > 0 ? data[data.length - 1].timestamp : 1);

  // 当前播放位置（毫秒）
  const currentPosition = isSliding
    ? sliderValue
    : (status?.currentTime || 0) * 1000;

  // 等距分桶生成波形：按图表宽度定好条数，每根条对应一段等长时间、取桶内最大分贝，
  // 均匀铺满整条宽度。避免"按时间戳定位"导致的间距忽大忽小、不规则留白。
  const chartData = useMemo(() => {
    if (data.length === 0 || !maxTime) return { bars: [], maxDecibel: 0 };

    const slot = BAR_WIDTH + BAR_GAP;
    const barCount = Math.max(1, Math.floor(chartWidth / slot));

    // 每桶的最大分贝 + 峰值时间戳（跳转用）
    const decibels = new Array(barCount).fill(0);
    const peakTs = new Array(barCount).fill(-1);
    for (const point of data) {
      // 分贝 <= 0 表示 metering 无效/该 250ms 槽无采样（定时器漂移会周期性跳槽），
      // 不计入桶，避免出现 0 高度的空条
      if (point.decibel <= 0) continue;
      let b = Math.floor((point.timestamp / maxTime) * barCount);
      if (b < 0) b = 0;
      else if (b >= barCount) b = barCount - 1;
      if (point.decibel > decibels[b]) {
        decibels[b] = point.decibel;
        peakTs[b] = point.timestamp;
      }
    }

    // 前向填充无有效数据的桶（用前一根条的高度延续），让波形连续不断条
    for (let i = 1; i < barCount; i++) {
      if (decibels[i] === 0) decibels[i] = decibels[i - 1];
    }
    // 反向填充开头的空桶：录音启动有 1~2 秒延迟，最早的采样时间戳不从 0 开始，
    // 短录音里开头会空一段；用第一个有效值补齐（前向填充填不到开头）
    for (let i = barCount - 2; i >= 0; i--) {
      if (decibels[i] === 0) decibels[i] = decibels[i + 1];
    }

    const maxDecibel = Math.max(
      ...decibels,
      mode === 'manual' ? threshold + 10 : 1
    );

    // 标记每根条是否与打鼾事件时间段重叠（事件、桶都按时间有序，双指针）
    let ei = 0;
    const bars = [];
    for (let i = 0; i < barCount; i++) {
      const bucketStart = (i / barCount) * maxTime;
      const bucketEnd = ((i + 1) / barCount) * maxTime;
      let isSnore = false;
      if (mode === 'auto') {
        while (ei < snoreEvents.length && snoreEvents[ei].endTime <= bucketStart) ei++;
        isSnore = ei < snoreEvents.length && snoreEvents[ei].startTime < bucketEnd;
      }
      bars.push({
        x: i * slot,
        decibel: decibels[i],
        isSnore,
        timestamp: peakTs[i] >= 0 ? peakTs[i] : bucketStart,
      });
    }

    return { bars, maxDecibel };
  }, [data, chartWidth, threshold, maxTime, mode, snoreEvents]);

  // 横轴当地时钟刻度：从录音开始时间起，按时长等分几个时刻（用设备本地时区/格式）
  const timeAxisTicks = useMemo(() => {
    if (!startTime || !maxTime) return [];
    const tickCount = Math.max(3, Math.min(6, Math.floor(chartWidth / 72)));
    const ticks: string[] = [];
    for (let i = 0; i < tickCount; i++) {
      const t = (i / (tickCount - 1)) * maxTime;
      ticks.push(
        new Date(startTime + t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
    }
    return ticks;
  }, [startTime, maxTime, chartWidth]);

  // 当前播放位置 X 坐标
  const currentPositionX = useMemo(() => {
    if (!maxTime) return 0;
    const x = (currentPosition / maxTime) * chartWidth;
    return Math.max(0, Math.min(x, chartWidth));
  }, [currentPosition, maxTime, chartWidth]);

  // 阈值线 Y 坐标（与波形对齐）
  // 波形从底部开始，高度为 (decibel / maxDecibel) * chartHeight * 0.85
  // 阈值线应该与对应分贝值的波形条顶部对齐
  const thresholdY = useMemo(() => {
    if (!chartData.maxDecibel) return chartHeight * 0.5;
    // 阈值线位置 = 图表高度 - 阈值对应的波形条高度
    const thresholdBarHeight = (localThreshold / chartData.maxDecibel) * chartHeight * 0.85;
    return chartHeight - thresholdBarHeight;
  }, [chartData.maxDecibel, chartHeight, localThreshold]);

  // 自绘阈值滑块：拇指位置与阈值线使用同一映射公式，保证严格对齐
  // 映射：value = (chartHeight - y) / (chartHeight * 0.85) * maxDecibel（与波形条高度一致）
  const thresholdPanResponder = useMemo(() => {
    const yToValue = (y: number) => {
      const maxDb = chartData.maxDecibel || 100;
      const clampedY = Math.max(0, Math.min(chartHeight, y));
      const value = ((chartHeight - clampedY) / (chartHeight * 0.85)) * maxDb;
      return Math.round(Math.max(0, Math.min(maxDb, value)));
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // 抓住手势后不让父级 ScrollView 抢走，避免拖阈值时页面上下滚动
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (event) => {
        setLocalThreshold(yToValue(event.nativeEvent.locationY));
      },
      onPanResponderMove: (event) => {
        setLocalThreshold(yToValue(event.nativeEvent.locationY));
      },
      onPanResponderRelease: (event) => {
        const value = yToValue(event.nativeEvent.locationY);
        setLocalThreshold(value);
        onThresholdChange?.(value);
      },
    });
  }, [chartHeight, chartData.maxDecibel, onThresholdChange]);

  // 播放到自动暂停位置时停下（如打鼾片段播放完毕）
  useEffect(() => {
    const stop = stopAtRef.current;
    if (!stop || !status?.playing) return;
    const positionMs = (status.currentTime || 0) * 1000;
    if (!stop.armed) {
      // 等 seek 生效、播放位置进入片段窗口后再武装，避免用跳转前的旧位置误判
      if (positionMs >= stop.fromMs && positionMs < stop.stopAtMs) {
        stop.armed = true;
      }
      return;
    }
    if (positionMs >= stop.stopAtMs) {
      stopAtRef.current = null;
      try {
        player.pause();
      } catch (e) {
      }
    }
  }, [status?.currentTime, status?.playing, player]);

  // 播放状态回调：父级用来高亮正在播放的打鼾片段
  useEffect(() => {
    onPlaybackState?.(!!status?.playing, (status?.currentTime || 0) * 1000);
  }, [status?.playing, status?.currentTime, onPlaybackState]);

  // 点击图表处理：找到最近的红色波形条（识别为呼噜/超阈值）并跳转
  const handleChartPress = useCallback((event: GestureResponderEvent) => {
    const touchX = event.nativeEvent.locationX;

    // 找到最近的红色波形条
    let nearestRedPoint: { timestamp: number; x: number } | null = null;
    let minDistance = Infinity;

    for (const bar of chartData.bars) {
      const isRed = mode === 'auto' ? bar.isSnore : bar.decibel >= localThreshold;
      if (isRed) {
        const distance = Math.abs(touchX - bar.x);
        if (distance < minDistance) {
          minDistance = distance;
          nearestRedPoint = bar;
        }
      }
    }

    // 如果找到了红色波形条且在50像素内，跳转到该位置（提前2秒，让用户听到完整呼噜声）
    if (nearestRedPoint && minDistance < 50) {
      try {
        stopAtRef.current = null;
        const jumpPosition = Math.max(0, nearestRedPoint.timestamp - 2000);
        player.seekTo(jumpPosition / 1000);
        if (!status?.playing) {
          player.play();
        }
      } catch (e) {
      }
    }
  }, [chartData.bars, localThreshold, mode, player, status?.playing]);

  // 播放/暂停
  const handlePlayPause = useCallback(() => {
    try {
      stopAtRef.current = null;
      if (status?.playing) {
        player.pause();
      } else {
        player.play();
      }
    } catch (e) {
    }
  }, [player, status?.playing]);

  // 跳转到指定位置并播放（供外部通过 ref 调用，如打鼾片段列表）
  // 无条件 play()：不管当前在播放还是暂停，点击片段总是播放那一段
  const seekToAndPlay = useCallback((positionMs: number, stopAtMs?: number) => {
    try {
      const fromMs = Math.max(0, positionMs);
      stopAtRef.current = stopAtMs !== undefined ? { fromMs, stopAtMs, armed: false } : null;
      player.seekTo(fromMs / 1000);
      player.play();
    } catch (e) {
    }
  }, [player]);

  const pause = useCallback(() => {
    try {
      stopAtRef.current = null;
      player.pause();
    } catch (e) {
    }
  }, [player]);

  useImperativeHandle(ref, () => ({ seekToAndPlay, pause }), [seekToAndPlay, pause]);

  // 快退15秒
  const handleSkipBackward = useCallback(() => {
    try {
      stopAtRef.current = null;
      const newPosition = Math.max(0, currentPosition - 15000);
      player.seekTo(newPosition / 1000);
    } catch (e) {
    }
  }, [player, currentPosition]);

  // 快进15秒
  const handleSkipForward = useCallback(() => {
    try {
      stopAtRef.current = null;
      const newPosition = Math.min(maxTime, currentPosition + 15000);
      player.seekTo(newPosition / 1000);
    } catch (e) {
    }
  }, [player, currentPosition, maxTime]);

  // 自绘进度条：与图表共用同一坐标系（宽度 = chartWidth，无原生滑块的内边距），
  // 保证进度条拇指与图表中的播放位置指示线严格对齐
  const scrubberPanResponder = useMemo(() => {
    const xToTime = (x: number) =>
      (Math.max(0, Math.min(chartWidth, x)) / chartWidth) * maxTime;

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // 抓住手势后不让父级 ScrollView 抢走
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (event) => {
        stopAtRef.current = null;
        setIsSliding(true);
        setSliderValue(xToTime(event.nativeEvent.locationX));
      },
      onPanResponderMove: (event) => {
        setSliderValue(xToTime(event.nativeEvent.locationX));
      },
      onPanResponderRelease: (event) => {
        const time = xToTime(event.nativeEvent.locationX);
        try {
          player.seekTo(time / 1000);
        } catch (e) {
        }
        setIsSliding(false);
      },
      onPanResponderTerminate: () => {
        setIsSliding(false);
      },
    });
  }, [chartWidth, maxTime, player]);

  return (
    <View style={styles.container} onLayout={onLayout}>
      {/* 图表和阈值滑块行 */}
      <View style={styles.chartRow}>
        {/* 图表区域 */}
        <TouchableOpacity
          style={{ height: chartHeight, width: chartWidth, overflow: 'hidden' }}
          onPress={handleChartPress}
          activeOpacity={0.9}
        >
          {/* 背景 */}
          <View style={[styles.chartBackground, { backgroundColor: colors.surfaceSunken }]}>
            {/* 网格线和分贝刻度 */}
            {[0.33, 0.66].map((ratio) => (
              <View key={ratio}>
                <View
                  style={[
                    styles.gridLine,
                    { top: chartHeight * ratio, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
                  ]}
                />
                {chartData.maxDecibel > 0 && (
                  <ThemedText
                    style={[styles.gridLabel, { top: chartHeight * ratio - 14 }]}
                  >
                    {Math.round(((1 - ratio) / 0.85) * chartData.maxDecibel)}dB
                  </ThemedText>
                )}
              </View>
            ))}
          </View>

          {/* 阈值线（仅手动模式） */}
          {mode === 'manual' && (
            <View
              style={[
                styles.thresholdLine,
                { top: thresholdY, backgroundColor: colors.severity.moderate },
              ]}
              pointerEvents="none"
            />
          )}

          {/* 波形（等距铺满） */}
          {chartData.bars.map((bar, index) => {
            const barHeight = Math.max(2, (bar.decibel / (chartData.maxDecibel || 100)) * chartHeight * 0.85);
            const isRed = mode === 'auto' ? bar.isSnore : bar.decibel >= localThreshold;
            return (
              <View
                key={index}
                style={[
                  styles.waveformBar,
                  {
                    left: bar.x,
                    width: BAR_WIDTH,
                    height: barHeight,
                    bottom: 0,
                    backgroundColor: isRed ? colors.danger : colors.brand,
                    opacity: isRed ? 1 : 0.55,
                  },
                ]}
                pointerEvents="none"
              />
            );
          })}

          {/* 当前播放位置指示器 */}
          <View
            style={[
              styles.positionIndicator,
              { left: Math.max(0, Math.min(currentPositionX - 1, chartWidth - 2)) },
            ]}
            pointerEvents="none"
          />
        </TouchableOpacity>

        {/* 右侧自绘垂直阈值滑块（仅手动模式，拇指与阈值线严格对齐） */}
        {mode === 'manual' && (
          <View
            style={[styles.thresholdSliderContainer, { height: chartHeight }]}
            {...thresholdPanResponder.panHandlers}
          >
            <View style={[styles.thresholdTrack, { backgroundColor: colors.border }]} />
            <View
              style={[
                styles.thresholdThumb,
                {
                  top: Math.max(0, Math.min(thresholdY - THRESHOLD_THUMB_SIZE / 2, chartHeight - THRESHOLD_THUMB_SIZE)),
                  backgroundColor: colors.severity.moderate,
                },
              ]}
              pointerEvents="none"
            />
          </View>
        )}
      </View>

      {/* 横轴当地时钟刻度 */}
      {timeAxisTicks.length > 0 && (
        <View style={[styles.timeAxis, { width: chartWidth }]} pointerEvents="none">
          {timeAxisTicks.map((t, i) => (
            <ThemedText key={i} style={[styles.timeAxisLabel, { color: colors.textFaint }]}>
              {t}
            </ThemedText>
          ))}
        </View>
      )}

      {/* 自绘播放进度条（与图表指示线对齐） */}
      <View
        style={[styles.scrubber, { width: chartWidth }]}
        {...scrubberPanResponder.panHandlers}
      >
        <View style={[styles.scrubberTrack, { backgroundColor: colors.border }]}>
          <View style={[styles.scrubberProgress, { width: currentPositionX }]} />
        </View>
        <View
          style={[
            styles.scrubberThumb,
            { left: Math.max(0, Math.min(currentPositionX - SCRUBBER_THUMB_SIZE / 2, chartWidth - SCRUBBER_THUMB_SIZE)) },
          ]}
          pointerEvents="none"
        />
      </View>

      {/* 时间指示 */}
      <View style={[styles.timeBar, { width: chartWidth }]}>
        <ThemedText style={styles.currentTimeText}>
          {formatTime(currentPosition)}
        </ThemedText>
        <ThemedText style={styles.totalTimeText}>
          {formatTime(duration)}
        </ThemedText>
      </View>

      {/* 播放控制按钮 */}
      <View style={[styles.controlsRow, { width: chartWidth }]}>
        <SkipButton
          direction="backward"
          onPress={handleSkipBackward}
        />

        <TouchableOpacity
          style={[styles.controlButton, styles.playControlButton, { backgroundColor: colors.brandSoft }]}
          onPress={handlePlayPause}
          activeOpacity={0.8}
          accessibilityLabel={status?.playing ? '暂停' : '播放'}
          accessibilityRole="button"
        >
          {status?.playing ? (
            <Ionicons name="pause" size={24} color={colors.brand} />
          ) : (
            <Ionicons name="play" size={24} color={colors.brand} />
          )}
        </TouchableOpacity>

        <SkipButton
          direction="forward"
          onPress={handleSkipForward}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  chartBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
  gridLabel: {
    position: 'absolute',
    right: 4,
    fontSize: 9,
    lineHeight: 12,
    opacity: 0.4,
  },
  thresholdLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    opacity: 0.6,
  },
  waveformBar: {
    position: 'absolute',
    borderRadius: 1,
  },
  positionIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: Palette.brand,
  },
  timeAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timeAxisLabel: {
    fontSize: 10,
  },
  scrubber: {
    height: SCRUBBER_HEIGHT,
    justifyContent: 'center',
    marginTop: 2,
  },
  scrubberTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  scrubberProgress: {
    height: 4,
    backgroundColor: Palette.brand,
  },
  scrubberThumb: {
    position: 'absolute',
    width: SCRUBBER_THUMB_SIZE,
    height: SCRUBBER_THUMB_SIZE,
    borderRadius: SCRUBBER_THUMB_SIZE / 2,
    backgroundColor: Palette.brand,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    top: (SCRUBBER_HEIGHT - SCRUBBER_THUMB_SIZE) / 2,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    marginTop: 8,
    marginBottom: 4,
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playControlButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  skipButton: {
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButtonContent: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    width: 28,
    height: 28,
  },
  skipButtonText: {
    fontSize: 10,
    fontWeight: '800',
    position: 'absolute',
    top: '30%',
    left: '50%',
    transform: [{ translateX: -6 }, { translateY: -5.9 }],
    textAlign: 'center',
  },
  timeBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  currentTimeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.brand,
  },
  totalTimeText: {
    fontSize: 12,
    opacity: 0.6,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  thresholdSliderContainer: {
    width: THRESHOLD_SLIDER_WIDTH,
    alignItems: 'center',
  },
  thresholdTrack: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 4,
    borderRadius: 2,
  },
  thresholdThumb: {
    position: 'absolute',
    width: THRESHOLD_THUMB_SIZE,
    height: THRESHOLD_THUMB_SIZE,
    borderRadius: THRESHOLD_THUMB_SIZE / 2,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});
