import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { setAudioModeAsync } from 'expo-audio';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AudioPlayerChart } from '@/components/audio-player-chart';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import {
  Recording,
  SnoreEvent,
  getRecording,
  updateRecording,
  deleteRecording,
  formatDuration,
  formatDate,
  analyzeDecibelData,
  SNORE_THRESHOLD_DB,
  MIN_SNORE_DURATION_MS,
} from '@/utils/storage';

export default function RecordingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [threshold, setThreshold] = useState(SNORE_THRESHOLD_DB);

  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === 'dark';

  // 基于当前阈值动态计算打鼾事件
  const dynamicSnoreEvents = useMemo(() => {
    if (!recording?.decibelData || recording.decibelData.length === 0) return [];
    
    const events: SnoreEvent[] = [];
    let currentEvent: { startTime: number; maxDecibel: number } | null = null;
    
    for (const point of recording.decibelData) {
      const isAboveThreshold = point.decibel >= threshold;
      if (isAboveThreshold) {
        if (!currentEvent) {
          currentEvent = { startTime: point.timestamp, maxDecibel: point.decibel };
        } else {
          currentEvent.maxDecibel = Math.max(currentEvent.maxDecibel, point.decibel);
        }
      } else {
        if (currentEvent) {
          const duration = point.timestamp - currentEvent.startTime;
          if (duration >= MIN_SNORE_DURATION_MS) {
            events.push({
              startTime: currentEvent.startTime,
              endTime: point.timestamp,
              maxDecibel: currentEvent.maxDecibel,
            });
          }
          currentEvent = null;
        }
      }
    }
    
    // 处理最后一个事件
    if (currentEvent && recording.decibelData.length > 0) {
      const lastPoint = recording.decibelData[recording.decibelData.length - 1];
      const duration = lastPoint.timestamp - currentEvent.startTime;
      if (duration >= MIN_SNORE_DURATION_MS) {
        events.push({
          startTime: currentEvent.startTime,
          endTime: lastPoint.timestamp,
          maxDecibel: currentEvent.maxDecibel,
        });
      }
    }
    
    return events;
  }, [recording?.decibelData, threshold]);

  const loadRecording = useCallback(async () => {
    if (id) {
      console.log('[RecordingDetail] Loading recording with ID:', id);
      const data = await getRecording(id);
      console.log('[RecordingDetail] Loaded recording:', {
        id: data?.id,
        uri: data?.uri,
        createdAt: data?.createdAt,
        duration: data?.duration,
      });
      setRecording(data);
      // 加载录音保存的阈值，如果没有则使用默认值
      if (data?.threshold !== undefined) {
        setThreshold(data.threshold);
      }
    }
  }, [id]);

  useEffect(() => {
    loadRecording();
  }, [loadRecording]);

  // 设置音频模式 - 从扬声器播放
  useEffect(() => {
    const setupAudioMode = async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldRouteThroughEarpiece: false, // 从扬声器播放，而非听筒
          interruptionMode: 'doNotMix',
          allowsRecording: false,
          shouldPlayInBackground: false,
        });
      } catch (e) {
        console.error('Failed to set audio mode:', e);
      }
    };
    setupAudioMode();
  }, []);

  const handleDelete = () => {
    if (!recording) return;
    
    Alert.alert('删除录音', '确定要删除这条录音吗？此操作无法撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteRecording(recording.id);
            router.back();
          } catch (error) {
            console.error('Delete error:', error);
            Alert.alert('错误', '删除失败，请重试');
          }
        },
      },
    ]);
  };

  // 导出录音
  const handleExport = async () => {
    if (!recording) return;
    
    try {
      // 检查是否支持分享
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert('不支持', '当前设备不支持分享功能');
        return;
      }
      
      // 检查文件是否存在
      const sourceFile = new File(recording.uri);
      if (!sourceFile.exists) {
        Alert.alert('错误', '录音文件不存在');
        return;
      }
      
      // 生成友好的文件名
      const date = new Date(recording.createdAt);
      const dateStr = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;
      const timeStr = `${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}`;
      const fileName = `睡眠录音_${dateStr}_${timeStr}.m4a`;
      
      // 复制到临时目录并重命名
      const tempFile = new File(Paths.cache, fileName);
      sourceFile.copy(tempFile);
      
      // 分享文件
      await Sharing.shareAsync(tempFile.uri, {
        mimeType: 'audio/mp4',
        dialogTitle: '导出录音',
        UTI: 'public.mpeg-4-audio',
      });
      
      // 清理临时文件
      try {
        tempFile.delete();
      } catch (e) {
        // 忽略清理错误
      }
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('错误', '导出失败，请重试');
    }
  };

  if (!recording) {
    return (
      <ThemedView style={[styles.container, styles.centerContent]}>
        <Stack.Screen options={{ title: '加载中...' }} />
        <ActivityIndicator size="large" color={colors.tint} />
      </ThemedView>
    );
  }

  const decibelData = recording.decibelData || [];
  const hasDecibelData = decibelData.length > 0;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: '录音详情',
          headerBackTitle: '返回',
        }}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
      >
        {/* 播放器和分贝曲线整合组件 */}
        {hasDecibelData ? (
          <View
            style={[
              styles.card,
              { backgroundColor: isDark ? '#1E1E1E' : '#F8F9FA' },
            ]}
          >
            {/* 图例说明 */}
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#6C63FF' }]} />
                <ThemedText style={styles.legendText}>正常</ThemedText>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#F44336' }]} />
                <ThemedText style={styles.legendText}>超阈值</ThemedText>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendLine, { backgroundColor: '#FF9800' }]} />
                <ThemedText style={styles.legendText}>阈值 {threshold}dB</ThemedText>
              </View>
            </View>

            {/* 图表区域 */}
            <AudioPlayerChart
              uri={recording.uri}
              data={decibelData}
              duration={recording.duration}
              threshold={threshold}
              height={200}
              onThresholdChange={async (value) => {
                setThreshold(value);
                if (recording) {
                  const newAnalysis = analyzeDecibelData(recording.decibelData, value);
                  await updateRecording(recording.id, {
                    threshold: value,
                    analysis: newAnalysis,
                  });
                  await loadRecording();
                }
              }}
            />

            {/* 说明文字 */}
            <ThemedText style={styles.hintText}>
              点击红色波形跳转播放，拖动右侧滑块调节阈值
            </ThemedText>
          </View>
        ) : (
          <View
            style={[
              styles.card,
              { backgroundColor: isDark ? '#1E1E1E' : '#F8F9FA' },
            ]}
          >
            <View style={styles.noDataContainer}>
              <ThemedText style={styles.noDataText}>
                此录音没有分贝数据
              </ThemedText>
              <ThemedText style={styles.noDataSubtext}>
                旧版本录音不包含分贝监测数据
              </ThemedText>
            </View>
          </View>
        )}

        {/* 操作按钮 */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity
            style={styles.exportButton}
            onPress={handleExport}
            activeOpacity={0.8}
          >
            <ThemedText style={styles.exportButtonText}>导出录音</ThemedText>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.deleteButton}
            onPress={handleDelete}
            activeOpacity={0.8}
          >
            <ThemedText style={styles.deleteButtonText}>删除</ThemedText>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  card: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginBottom: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  legendLine: {
    width: 14,
    height: 3,
    borderRadius: 1,
    marginRight: 6,
  },
  legendText: {
    fontSize: 12,
    opacity: 0.7,
  },
  hintText: {
    fontSize: 13,
    opacity: 0.6,
    textAlign: 'center',
    marginTop: 88,
  },
  noDataContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noDataText: {
    fontSize: 16,
    opacity: 0.6,
  },
  noDataSubtext: {
    fontSize: 13,
    opacity: 0.4,
    marginTop: 6,
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  deleteButton: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F44336',
  },
  deleteButtonText: {
    color: '#F44336',
    fontSize: 15,
    fontWeight: '600',
  },
  exportButton: {
    flex: 2,
    backgroundColor: '#6C63FF',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  exportButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
