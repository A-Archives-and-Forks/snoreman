import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  LayoutChangeEvent,
  GestureResponderEvent,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { DecibelDataPoint } from '@/utils/storage';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ThemedText } from '@/components/themed-text';
import { Ionicons, AntDesign } from '@expo/vector-icons';

// 15秒跳转按钮组件
interface SkipButtonProps {
  direction: 'backward' | 'forward';
  onPress: () => void;
  size?: number;
}

function SkipButton({ direction, onPress, size = 48 }: SkipButtonProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const iconColor = isDark ? '#FFFFFF' : '#6C63FF';
  const bgColor = isDark ? 'rgba(255,255,255,0.1)' : '#E8E5FF';
  
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

interface AudioPlayerChartProps {
  uri: string;
  data: DecibelDataPoint[];
  duration: number; // 总时长（毫秒）
  threshold?: number;
  height?: number;
  onThresholdChange?: (value: number) => void;
}

const DEFAULT_HEIGHT = 200;
const TIME_BAR_HEIGHT = 10; // 底部时间栏高度
const SLIDER_HEIGHT = 20; // 滑块区域高度
const THRESHOLD_SLIDER_WIDTH = 7; // 阈值滑块宽度

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

export function AudioPlayerChart({
  uri,
  data,
  duration,
  threshold = 45,
  height = DEFAULT_HEIGHT,
  onThresholdChange,
}: AudioPlayerChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  
  // 播放器
  const player = useAudioPlayer(uri ? { uri } : null);
  const status = useAudioPlayerStatus(player);
  
  const [isSliding, setIsSliding] = useState(false);
  const [sliderValue, setSliderValue] = useState<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(300);
  const [localThreshold, setLocalThreshold] = useState<number>(threshold);
  
  // 图表区域尺寸（减去右侧阈值滑块宽度）
  const chartWidth = containerWidth - THRESHOLD_SLIDER_WIDTH;
  const chartHeight = height - TIME_BAR_HEIGHT - SLIDER_HEIGHT;
  
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
  
  // 降采样图表数据
  const chartData = useMemo(() => {
    if (data.length === 0) return { points: [], maxDecibel: 0 };
    
    const MAX_POINTS = 400;
    let sampledData = data;
    
    if (data.length > MAX_POINTS) {
      const step = Math.ceil(data.length / MAX_POINTS);
      sampledData = [];
      for (let i = 0; i < data.length; i += step) {
        const end = Math.min(i + step, data.length);
        let maxPoint = data[i];
        for (let j = i + 1; j < end; j++) {
          if (data[j].decibel > maxPoint.decibel) {
            maxPoint = data[j];
          }
        }
        sampledData.push(maxPoint);
      }
    }
    
    const maxDecibel = Math.max(...sampledData.map(d => d.decibel), threshold + 10);
    
    const points = sampledData.map((point) => ({
      x: (point.timestamp / maxTime) * chartWidth,
      decibel: point.decibel,
      isAboveThreshold: point.decibel >= threshold,
      timestamp: point.timestamp,
    }));
    
    return { points, maxDecibel };
  }, [data, chartWidth, threshold, maxTime]);
  
  // 当前播放位置 X 坐标
  const currentPositionX = useMemo(() => {
    if (!maxTime) return 0;
    return (currentPosition / maxTime) * chartWidth;
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
  
  // 阈值滑块改变
  const handleThresholdChange = useCallback((value: number) => {
    setLocalThreshold(value);
  }, []);
  
  // 阈值滑块释放
  const handleThresholdComplete = useCallback((value: number) => {
    setLocalThreshold(value);
    onThresholdChange?.(value);
  }, [onThresholdChange]);
  
  // 点击图表处理：找到最近的红色波形条（超阈值）并跳转
  const handleChartPress = useCallback((event: GestureResponderEvent) => {
    const touchX = event.nativeEvent.locationX;
    
    // 找到最近的红色波形条（超阈值的点）
    let nearestRedPoint: { timestamp: number; x: number } | null = null;
    let minDistance = Infinity;
    
    for (const point of chartData.points) {
      if (point.decibel >= localThreshold) {
        const distance = Math.abs(touchX - point.x);
        if (distance < minDistance) {
          minDistance = distance;
          nearestRedPoint = point;
        }
      }
    }
    
    // 如果找到了红色波形条且在50像素内，跳转到该位置（提前2秒，让用户听到完整呼噜声）
    if (nearestRedPoint && minDistance < 50) {
      try {
        const jumpPosition = Math.max(0, nearestRedPoint.timestamp - 2000);
        player.seekTo(jumpPosition / 1000);
        if (!status?.playing) {
          player.play();
        }
      } catch (e) {
      }
    }
  }, [chartData.points, localThreshold, player, status?.playing]);
  
  // 播放/暂停
  const handlePlayPause = useCallback(() => {
    try {
      if (status?.playing) {
        player.pause();
      } else {
        player.play();
      }
    } catch (e) {
    }
  }, [player, status?.playing]);

  // 快退15秒
  const handleSkipBackward = useCallback(() => {
    try {
      const newPosition = Math.max(0, currentPosition - 15000);
      player.seekTo(newPosition / 1000);
    } catch (e) {
    }
  }, [player, currentPosition]);

  // 快进15秒
  const handleSkipForward = useCallback(() => {
    try {
      const newPosition = Math.min(maxTime, currentPosition + 15000);
      player.seekTo(newPosition / 1000);
    } catch (e) {
    }
  }, [player, currentPosition, maxTime]);

  // 滑块改变
  const handleSliderChange = useCallback((value: number) => {
    setIsSliding(true);
    setSliderValue(value);
  }, []);
  
  // 滑块释放
  const handleSliderComplete = useCallback((value: number) => {
    try {
      player.seekTo(value / 1000);
      setIsSliding(false);
    } catch (e) {
      setIsSliding(false);
    }
  }, [player]);
  
  return (
    <View style={[styles.container, { height }]} onLayout={onLayout}>
      {/* 图表和阈值滑块行 */}
      <View style={styles.chartRow}>
        {/* 图表区域 */}
        <TouchableOpacity
          style={{ height: chartHeight, width: chartWidth, overflow: 'hidden' }}
          onPress={handleChartPress}
          activeOpacity={0.9}
        >
          {/* 背景 */}
          <View style={[styles.chartBackground, { backgroundColor: isDark ? '#1A1A1A' : '#F5F5F5' }]}>
            {/* 网格线 - 简化为3条线 */}
            {[0.33, 0.66].map((ratio) => (
              <View
                key={ratio}
                style={[
                  styles.gridLine,
                  { top: chartHeight * ratio, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
                ]}
              />
            ))}
          </View>

          {/* 阈值线 */}
          <View
            style={[
              styles.thresholdLine,
              { top: thresholdY, backgroundColor: '#FF9800' },
            ]}
            pointerEvents="none"
          />

          {/* 波形 */}
          {chartData.points.map((point, index) => {
            const barHeight = Math.max(2, (point.decibel / (chartData.maxDecibel || 100)) * chartHeight * 0.85);
            const isAboveLocalThreshold = point.decibel >= localThreshold;
            // 确保波形条不超出左边界
            const barLeft = Math.max(0, point.x - 1);
            // 确保波形条不超出右边界
            const barWidth = Math.min(2, chartWidth - barLeft);
            if (barWidth <= 0) return null;
            return (
              <View
                key={index}
                style={[
                  styles.waveformBar,
                  {
                    left: barLeft,
                    width: barWidth,
                    height: barHeight,
                    bottom: 0,
                    backgroundColor: isAboveLocalThreshold ? '#F44336' : '#6C63FF',
                    opacity: isAboveLocalThreshold ? 1 : 0.6,
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
          >
            <View style={styles.positionLine} />
            <View style={styles.positionHandle} />
          </View>

        </TouchableOpacity>

        {/* 右侧垂直阈值滑块 */}
        <View style={[styles.thresholdSliderContainer, { height: chartHeight }]}>
          <View style={styles.verticalSliderWrapper} pointerEvents="box-none">
            <View pointerEvents="auto">
              <Slider
                style={[styles.verticalSlider, { width: chartHeight, height: THRESHOLD_SLIDER_WIDTH }]}
                minimumValue={0}
                maximumValue={chartData.maxDecibel || 100}
                step={1}
                value={localThreshold}
                onValueChange={handleThresholdChange}
                onSlidingComplete={handleThresholdComplete}
                minimumTrackTintColor="#FF9800"
                maximumTrackTintColor={isDark ? '#333' : '#E0E0E0'}
                thumbTintColor="#FF9800"
                inverted={true}
              />
            </View>
          </View>
        </View>
      </View>

      {/* 时间滑块 */}
      <View style={styles.sliderContainer}>
        <View style={{ width: chartWidth }}>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={maxTime}
            value={currentPosition}
            onValueChange={handleSliderChange}
            onSlidingComplete={handleSliderComplete}
            minimumTrackTintColor="#6C63FF"
            maximumTrackTintColor={isDark ? '#333' : '#E0E0E0'}
            thumbTintColor="#6C63FF"
          />
        </View>
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
          style={[styles.controlButton, styles.playControlButton]}
          onPress={handlePlayPause}
          activeOpacity={0.8}
          accessibilityLabel={status?.playing ? '暂停' : '播放'}
          accessibilityRole="button"
        >
          {status?.playing ? (
            <Ionicons name="pause" size={24} color="#6C63FF" />
          ) : (
            <Ionicons name="play" size={24} color="#6C63FF" />
          )}
        </TouchableOpacity>

        <SkipButton
          direction="forward"
          onPress={handleSkipForward}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  chartArea: {
    overflow: 'hidden',
    // borderRadius: 8,
  },
  chartBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // borderRadius: 8,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
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
    width: 2,
    borderRadius: 1,
  },
  positionIndicator: {
    position: 'absolute',
    top: 0,
    bottom: -6,
    width: 2,
    alignItems: 'center',
  },
  positionLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#6C63FF',
  },
  positionHandle: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#6C63FF',
    marginTop: -2,
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
    backgroundColor: '#E8E5FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playControlButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#D4CFFF',
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
  skipButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
  sliderContainer: {
    width: '100%',
    marginTop: -10,
  },
  slider: {
    width: '100%',
    height: 30,
  },
  timeBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: -4,
  },
  currentTimeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6C63FF',
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
    justifyContent: 'space-between',
    padding: 0,
    margin: 0,
  },
  verticalSliderWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ rotate: '-90deg' }],
    pointerEvents: 'box-none',
  },
  verticalSlider: {
    // width and height set dynamically in component
  },
});
