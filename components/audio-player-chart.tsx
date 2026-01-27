import React, { useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  PanResponder,
} from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { DecibelDataPoint, SnoreEvent } from '@/utils/storage';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ThemedText } from '@/components/themed-text';

interface AudioPlayerChartProps {
  uri: string;
  data: DecibelDataPoint[];
  snoreEvents?: SnoreEvent[];
  duration: number; // 总时长（毫秒）
  threshold?: number;
  width?: number;
  height?: number;
}

const DEFAULT_WIDTH = Dimensions.get('window').width - 48;
const DEFAULT_HEIGHT = 160;
const TIME_BAR_HEIGHT = 24; // 底部时间栏高度

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
  snoreEvents = [],
  duration,
  threshold = 45,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
}: AudioPlayerChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  
  // 播放器
  const player = useAudioPlayer(uri ? { uri } : null);
  const status = useAudioPlayerStatus(player);
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState<number>(0);
  
  // 图表区域尺寸（全宽）
  const chartWidth = width;
  const chartHeight = height - TIME_BAR_HEIGHT;
  
  // 使用 duration 作为最大时间
  const maxTime = duration || (data.length > 0 ? data[data.length - 1].timestamp : 1);
  
  // 当前播放位置（毫秒）
  const currentPosition = isDragging 
    ? dragPosition 
    : (status?.currentTime || 0) * 1000;
  
  // 用 ref 保存最新的值供 PanResponder 使用
  const stateRef = useRef({ maxTime, chartWidth, player, status });
  stateRef.current = { maxTime, chartWidth, player, status };
  
  // 降采样图表数据
  const chartData = useMemo(() => {
    if (data.length === 0) return { points: [], maxDecibel: 0 };
    
    // 降采样
    const MAX_POINTS = 200;
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
  
  // 打鼾高亮区域
  const snoreRegions = useMemo(() => {
    if (snoreEvents.length === 0 || !maxTime) return [];
    
    return snoreEvents.map((event) => ({
      x: (event.startTime / maxTime) * chartWidth,
      width: Math.max(4, ((event.endTime - event.startTime) / maxTime) * chartWidth),
      event,
    }));
  }, [snoreEvents, maxTime, chartWidth]);
  
  // 当前播放位置 X 坐标
  const currentPositionX = useMemo(() => {
    if (!maxTime) return 0;
    return (currentPosition / maxTime) * chartWidth;
  }, [currentPosition, maxTime, chartWidth]);
  
  // 阈值线 Y 坐标
  const thresholdY = useMemo(() => {
    if (!chartData.maxDecibel) return chartHeight * 0.5;
    return chartHeight - (threshold / chartData.maxDecibel) * chartHeight * 0.85 - chartHeight * 0.05;
  }, [chartData.maxDecibel, chartHeight, threshold]);
  
  // 手势处理
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { maxTime, chartWidth } = stateRef.current;
        const x = evt.nativeEvent.locationX;
        const clampedX = Math.max(0, Math.min(x, chartWidth));
        const seekTime = (clampedX / chartWidth) * maxTime;
        setIsDragging(true);
        setDragPosition(seekTime);
      },
      onPanResponderMove: (evt) => {
        const { maxTime, chartWidth } = stateRef.current;
        const x = evt.nativeEvent.locationX;
        const clampedX = Math.max(0, Math.min(x, chartWidth));
        const seekTime = (clampedX / chartWidth) * maxTime;
        setDragPosition(seekTime);
      },
      onPanResponderRelease: (evt) => {
        const { maxTime, chartWidth, player, status } = stateRef.current;
        const x = evt.nativeEvent.locationX;
        const clampedX = Math.max(0, Math.min(x, chartWidth));
        const seekTime = (clampedX / chartWidth) * maxTime;
        
        try {
          player.seekTo(seekTime / 1000);
          if (!status?.playing) {
            player.play();
          }
        } catch (e) {
          console.error('Seek error:', e);
        }
        
        setIsDragging(false);
      },
      onPanResponderTerminate: () => {
        setIsDragging(false);
      },
    })
  ).current;
  
  // 播放/暂停
  const handlePlayPause = useCallback(() => {
    try {
      if (status?.playing) {
        player.pause();
      } else {
        player.play();
      }
    } catch (e) {
      console.error('PlayPause error:', e);
    }
  }, [player, status?.playing]);
  
  return (
    <View style={[styles.container, { width, height }]}>
      {/* 图表区域 */}
      <View 
        style={[styles.chartArea, { width: chartWidth, height: chartHeight }]}
        {...panResponder.panHandlers}
      >
        {/* 背景 */}
        <View style={[styles.chartBackground, { backgroundColor: isDark ? '#1A1A1A' : '#F5F5F5' }]}>
          {/* 网格线 */}
          {[0.25, 0.5, 0.75].map((ratio) => (
            <View
              key={ratio}
              style={[
                styles.gridLine,
                { top: chartHeight * ratio, backgroundColor: isDark ? '#333' : '#E0E0E0' },
              ]}
            />
          ))}
        </View>
        
        {/* 打鼾高亮区域 */}
        {snoreRegions.map((region, index) => (
          <View
            key={index}
            style={[
              styles.snoreRegion,
              {
                left: region.x,
                width: region.width,
                height: chartHeight,
                backgroundColor: 'rgba(244, 67, 54, 0.15)',
              },
            ]}
            pointerEvents="none"
          />
        ))}
        
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
          return (
            <View
              key={index}
              style={[
                styles.waveformBar,
                {
                  left: point.x - 1,
                  height: barHeight,
                  bottom: 0,
                  backgroundColor: point.isAboveThreshold ? '#F44336' : '#6C63FF',
                  opacity: point.isAboveThreshold ? 1 : 0.7,
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
        
        {/* 播放按钮（左下角，在图表内） */}
        <TouchableOpacity
          style={[styles.playButton, { backgroundColor: 'rgba(108, 99, 255, 0.9)' }]}
          onPress={handlePlayPause}
          activeOpacity={0.8}
        >
          {status?.playing ? (
            <View style={styles.pauseIcon}>
              <View style={styles.pauseBar} />
              <View style={styles.pauseBar} />
            </View>
          ) : (
            <View style={styles.playIcon} />
          )}
        </TouchableOpacity>
      </View>
      
      {/* 底部时间栏 */}
      <View style={[styles.timeBar, { width: chartWidth }]}>
        <ThemedText style={styles.currentTimeText}>
          {formatTime(currentPosition)}
        </ThemedText>
        <ThemedText style={styles.totalTimeText}>
          {formatTime(duration)}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  chartArea: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 8,
  },
  chartBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
  snoreRegion: {
    position: 'absolute',
    top: 0,
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
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
  },
  positionHandle: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#6C63FF',
    marginTop: -2,
  },
  playButton: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftColor: '#FFFFFF',
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    marginLeft: 2,
  },
  pauseIcon: {
    flexDirection: 'row',
    gap: 3,
  },
  pauseBar: {
    width: 3,
    height: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 1,
  },
  timeBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingTop: 6,
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
});
