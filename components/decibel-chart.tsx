import React from 'react';
import { View, StyleSheet } from 'react-native';
import { DecibelDataPoint, SNORE_THRESHOLD_DB } from '@/utils/storage';
import { useTheme } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';

// 录音时的实时波形显示：展示最近若干个分贝采样点
interface LiveWaveformProps {
  recentData: DecibelDataPoint[];
  height?: number;
  threshold?: number;
}

export function LiveWaveform({ recentData, height = 60, threshold = SNORE_THRESHOLD_DB }: LiveWaveformProps) {
  const { colors } = useTheme();

  // 只显示最近的数据点，最多10个
  const MAX_BARS = 10;
  const displayData = recentData.slice(-MAX_BARS);
  const dataCount = displayData.length || 1;

  // 计算每个条的宽度百分比，留出微小间隙
  const barWidthPercent = (100 / MAX_BARS) * 0.95;

  return (
    <View style={[styles.liveWaveform, { height }]}>
      {displayData.map((point, index) => {
        const barHeight = Math.max(4, (point.decibel / 100) * height * 0.9);
        const isAboveThreshold = point.decibel >= threshold;
        return (
          <View
            key={index}
            style={[
              styles.liveBar,
              {
                width: `${barWidthPercent}%`,
                height: barHeight,
                backgroundColor: isAboveThreshold ? Palette.danger : colors.brand,
                opacity: 0.3 + (index / dataCount) * 0.7,
                marginRight: index < displayData.length - 1 ? 1 : 0,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  liveWaveform: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    overflow: 'hidden',
  },
  liveBar: {},
});
