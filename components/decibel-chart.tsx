import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import { DecibelDataPoint, SNORE_THRESHOLD_DB, SnoreEvent } from '@/utils/storage';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface DecibelChartProps {
  data: DecibelDataPoint[];
  snoreEvents?: SnoreEvent[];
  width?: number;
  height?: number;
  showThreshold?: boolean;
  highlightSnoring?: boolean;
  currentPosition?: number; // 当前播放位置（毫秒）
  threshold?: number; // 自定义阈值
  onSnoreEventPress?: (event: SnoreEvent) => void; // 点击打鼾事件回调
}

const DEFAULT_WIDTH = Dimensions.get('window').width - 48;
const DEFAULT_HEIGHT = 120;

export function DecibelChart({
  data,
  snoreEvents = [],
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  showThreshold = true,
  highlightSnoring = true,
  currentPosition,
  threshold = SNORE_THRESHOLD_DB,
  onSnoreEventPress,
}: DecibelChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // 计算图表数据
  const chartData = useMemo(() => {
    if (data.length === 0) return { points: [], maxTime: 0 };

    const maxTime = data[data.length - 1].timestamp;
    const maxDecibel = Math.max(...data.map(d => d.decibel), threshold + 10);
    
    // 将数据点转换为坐标
    const points = data.map((point) => ({
      x: (point.timestamp / maxTime) * width,
      y: height - (point.decibel / maxDecibel) * height * 0.9 - height * 0.05,
      decibel: point.decibel,
      isAboveThreshold: point.decibel >= threshold,
      timestamp: point.timestamp,
    }));

    return { points, maxTime, maxDecibel };
  }, [data, width, height, threshold]);

  // 生成 SVG 路径
  const pathData = useMemo(() => {
    if (chartData.points.length < 2) return '';
    
    const points = chartData.points;
    let path = `M ${points[0].x} ${points[0].y}`;
    
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x} ${points[i].y}`;
    }
    
    return path;
  }, [chartData.points]);

  // 阈值线位置
  const thresholdY = useMemo(() => {
    if (!chartData.maxDecibel) return height * 0.5;
    return height - (threshold / chartData.maxDecibel) * height * 0.9 - height * 0.05;
  }, [chartData.maxDecibel, height, threshold]);

  // 打鼾区域
  const snoreRegions = useMemo(() => {
    if (!highlightSnoring || snoreEvents.length === 0 || chartData.maxTime === 0) return [];
    
    return snoreEvents.map((event) => ({
      x: (event.startTime / chartData.maxTime) * width,
      width: Math.max(8, ((event.endTime - event.startTime) / chartData.maxTime) * width),
      event,
    }));
  }, [snoreEvents, chartData.maxTime, width, highlightSnoring]);

  // 当前播放位置
  const currentPositionX = useMemo(() => {
    if (currentPosition === undefined || chartData.maxTime === 0) return null;
    return (currentPosition / chartData.maxTime) * width;
  }, [currentPosition, chartData.maxTime, width]);

  if (data.length === 0) {
    return (
      <View style={[styles.container, { width, height }]}>
        <View style={[styles.emptyState, { backgroundColor: isDark ? '#2A2A2A' : '#F0F0F0' }]}>
          <View style={styles.emptyLine} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { width, height }]}>
      {/* 背景网格 */}
      <View style={[styles.gridBackground, { backgroundColor: isDark ? '#1A1A1A' : '#F8F9FA' }]}>
        {[0.25, 0.5, 0.75].map((ratio) => (
          <View
            key={ratio}
            style={[
              styles.gridLine,
              { top: height * ratio, backgroundColor: isDark ? '#333' : '#E0E0E0' },
            ]}
          />
        ))}
      </View>

      {/* 打鼾高亮区域（可点击） */}
      {snoreRegions.map((region, index) => (
        <TouchableOpacity
          key={index}
          style={[
            styles.snoreRegion,
            {
              left: region.x,
              width: region.width,
              height,
              backgroundColor: 'rgba(244, 67, 54, 0.15)',
            },
          ]}
          onPress={() => onSnoreEventPress?.(region.event)}
          activeOpacity={onSnoreEventPress ? 0.6 : 1}
        />
      ))}

      {/* 阈值线 */}
      {showThreshold && (
        <View
          style={[
            styles.thresholdLine,
            {
              top: thresholdY,
              backgroundColor: '#FF9800',
            },
          ]}
        />
      )}

      {/* 波形图 - 使用简单的竖线表示 */}
      <View style={styles.waveformContainer}>
        {chartData.points.map((point, index) => {
          const barHeight = Math.max(2, (point.decibel / (chartData.maxDecibel || 100)) * height * 0.85);
          return (
            <View
              key={index}
              style={[
                styles.waveformBar,
                {
                  left: point.x - 1,
                  height: barHeight,
                  bottom: height * 0.05,
                  backgroundColor: point.isAboveThreshold 
                    ? '#F44336' 
                    : (isDark ? '#6C63FF' : '#6C63FF'),
                  opacity: point.isAboveThreshold ? 1 : 0.7,
                },
              ]}
            />
          );
        })}
      </View>

      {/* 当前播放位置 */}
      {currentPositionX !== null && (
        <View
          style={[
            styles.currentPositionLine,
            { left: currentPositionX },
          ]}
        />
      )}
    </View>
  );
}

// 实时分贝显示组件
interface DecibelMeterProps {
  decibel: number;
  size?: number;
}

export function DecibelMeter({ decibel, size = 120 }: DecibelMeterProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  
  const isSnoring = decibel >= SNORE_THRESHOLD_DB;
  const percentage = Math.min(100, decibel);
  
  const color = isSnoring ? '#F44336' : '#6C63FF';
  
  return (
    <View style={[styles.meterContainer, { width: size, height: size }]}>
      {/* 背景圆环 */}
      <View 
        style={[
          styles.meterBackground,
          { 
            width: size, 
            height: size, 
            borderRadius: size / 2,
            borderColor: isDark ? '#333' : '#E0E0E0',
          },
        ]}
      />
      
      {/* 进度圆环 - 使用多个 segment 模拟 */}
      <View style={[styles.meterProgress, { width: size, height: size }]}>
        {Array.from({ length: 20 }, (_, i) => {
          const angle = (i / 20) * 360 - 90;
          const isActive = (i / 20) * 100 <= percentage;
          const radius = size / 2 - 8;
          const x = Math.cos((angle * Math.PI) / 180) * radius + size / 2 - 3;
          const y = Math.sin((angle * Math.PI) / 180) * radius + size / 2 - 3;
          
          return (
            <View
              key={i}
              style={[
                styles.meterDot,
                {
                  left: x,
                  top: y,
                  backgroundColor: isActive ? color : (isDark ? '#333' : '#E0E0E0'),
                },
              ]}
            />
          );
        })}
      </View>
      
      {/* 中心数值 */}
      <View style={styles.meterCenter}>
        <View style={[styles.meterValueContainer, { backgroundColor: isDark ? '#1E1E1E' : '#FFF' }]}>
          <View style={styles.meterValue}>
            <View style={{ alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                <View style={[styles.decibelNumber, { }]}>
                  <View style={{ flexDirection: 'row' }}>
                    {String(Math.round(decibel)).split('').map((digit, i) => (
                      <View key={i} style={[styles.digitBox, { backgroundColor: color + '20' }]}>
                        <View style={[styles.digitText, { }]} />
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

// 简化的实时波形显示
interface LiveWaveformProps {
  recentData: DecibelDataPoint[];
  width?: number;
  height?: number;
  threshold?: number;
}

export function LiveWaveform({ recentData, width = DEFAULT_WIDTH, height = 60, threshold = SNORE_THRESHOLD_DB }: LiveWaveformProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  
  // 只显示最近的数据点
  const displayData = recentData.slice(-60); // 最近30秒的数据
  const barWidth = width / 60;
  
  return (
    <View style={[styles.liveWaveform, { width, height, backgroundColor: isDark ? '#1A1A1A' : '#F8F9FA' }]}>
      {displayData.map((point, index) => {
        const barHeight = Math.max(4, (point.decibel / 100) * height * 0.9);
        const isAboveThreshold = point.decibel >= threshold;
        return (
          <View
            key={index}
            style={[
              styles.liveBar,
              {
                width: barWidth - 2,
                height: barHeight,
                backgroundColor: isAboveThreshold ? '#F44336' : '#6C63FF',
                opacity: 0.3 + (index / displayData.length) * 0.7,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12,
  },
  gridBackground: {
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
  waveformContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  waveformBar: {
    position: 'absolute',
    width: 2,
    borderRadius: 1,
  },
  currentPositionLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#FFFFFF',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  emptyLine: {
    width: '80%',
    height: 2,
    backgroundColor: '#9E9E9E',
    opacity: 0.3,
  },
  // Meter styles
  meterContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  meterBackground: {
    position: 'absolute',
    borderWidth: 8,
  },
  meterProgress: {
    position: 'absolute',
  },
  meterDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  meterCenter: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  meterValueContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  meterValue: {
    alignItems: 'center',
  },
  decibelNumber: {
    flexDirection: 'row',
  },
  digitBox: {
    width: 20,
    height: 28,
    marginHorizontal: 1,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  digitText: {
    width: 16,
    height: 20,
  },
  // Live waveform
  liveWaveform: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 8,
    paddingHorizontal: 2,
  },
  liveBar: {
    marginHorizontal: 1,
    borderRadius: 2,
  },
});
