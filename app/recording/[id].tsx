import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useAudioPlayer, useAudioPlayerStatus, AudioModule } from 'expo-audio';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DecibelChart } from '@/components/decibel-chart';
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

function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'none':
      return '#4CAF50';
    case 'mild':
      return '#8BC34A';
    case 'moderate':
      return '#FF9800';
    case 'severe':
      return '#F44336';
    default:
      return '#9E9E9E';
  }
}

function getSeverityText(severity: string): string {
  switch (severity) {
    case 'none':
      return '无打鼾';
    case 'mild':
      return '轻微';
    case 'moderate':
      return '中等';
    case 'severe':
      return '严重';
    default:
      return '未知';
  }
}

export default function RecordingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [threshold, setThreshold] = useState(SNORE_THRESHOLD_DB);

  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === 'dark';

  // 音频播放器 - 只在有录音 URI 时初始化
  const player = useAudioPlayer(recording?.uri ? { uri: recording.uri } : null);
  const status = useAudioPlayerStatus(player);

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
      const data = await getRecording(id);
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

  // 检查播放器是否准备好，并设置音频模式
  useEffect(() => {
    if (recording?.uri && player) {
      // 设置音频模式，确保通过扬声器播放
      AudioModule.setAudioModeAsync({
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false, // false = 使用扬声器
      });
      setIsPlayerReady(true);
    }
    return () => {
      setIsPlayerReady(false);
    };
  }, [recording?.uri, player]);

  // 清理播放器
  useEffect(() => {
    return () => {
      if (isPlayerReady) {
        try {
          player.pause();
        } catch (e) {
          // 忽略清理时的错误
        }
      }
    };
  }, [isPlayerReady, player]);

  const handlePlayPause = () => {
    if (!isPlayerReady) return;
    try {
      if (status.playing) {
        player.pause();
      } else {
        player.play();
      }
    } catch (e) {
      console.error('Playback error:', e);
    }
  };

  // 跳转到指定时间点并播放
  const handleSeekToEvent = async (event: SnoreEvent) => {
    if (!isPlayerReady) return;
    try {
      // 跳转到事件开始时间前0.5秒，确保能听到完整打鼾声
      const seekTime = Math.max(0, event.startTime / 1000 - 0.5);
      await player.seekTo(seekTime);
      player.play();
    } catch (e) {
      console.error('Seek error:', e);
    }
  };

  const handleAnalyze = async () => {
    if (!recording || isAnalyzing) return;

    // 检查是否有分贝数据
    if (!recording.decibelData || recording.decibelData.length === 0) {
      Alert.alert('无法分析', '此录音没有分贝数据，无法进行分析');
      return;
    }

    setIsAnalyzing(true);
    try {
      const analysis = analyzeDecibelData(recording.decibelData);
      await updateRecording(recording.id, { analysis });
      await loadRecording();
    } catch (error) {
      console.error('Analysis error:', error);
      Alert.alert('错误', '分析失败，请重试');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDelete = () => {
    if (!recording) return;
    
    Alert.alert('删除录音', '确定要删除这条录音吗？此操作无法撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            // 先暂停播放
            if (isPlayerReady) {
              try {
                player.pause();
              } catch (e) {
                // 忽略错误
              }
            }
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

  const handleExport = async () => {
    if (!recording) return;

    try {
      // 检查分享功能是否可用
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert('提示', '当前设备不支持分享功能');
        return;
      }

      // 先暂停播放
      if (isPlayerReady && status?.playing) {
        player.pause();
      }

      // 分享录音文件
      await Sharing.shareAsync(recording.uri, {
        mimeType: 'audio/m4a',
        dialogTitle: '导出录音',
        UTI: 'public.audio',
      });
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

  const analysis = recording.analysis;
  const decibelData = recording.decibelData || [];
  const hasDecibelData = decibelData.length > 0;
  const playbackPosition = (status?.currentTime || 0) * 1000; // 转换为毫秒
  // 使用播放器报告的实际音频时长，如果没有则使用保存的时长
  const actualDuration = status?.duration ? status.duration * 1000 : recording.duration;

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
        {/* Recording Info Card */}
        <View
          style={[
            styles.card,
            { backgroundColor: isDark ? '#1E1E1E' : '#F8F9FA' },
          ]}
        >
          <ThemedText style={styles.cardTitle}>录音信息</ThemedText>
          <View style={styles.infoRow}>
            <ThemedText style={styles.infoLabel}>录制时间</ThemedText>
            <ThemedText style={styles.infoValue}>
              {formatDate(recording.createdAt)}
            </ThemedText>
          </View>
          <View style={styles.infoRow}>
            <ThemedText style={styles.infoLabel}>录音时长</ThemedText>
            <ThemedText style={styles.infoValue}>
              {formatDuration(recording.duration)}
            </ThemedText>
          </View>
          <View style={styles.infoRow}>
            <ThemedText style={styles.infoLabel}>数据点数</ThemedText>
            <ThemedText style={styles.infoValue}>
              {decibelData.length}
            </ThemedText>
          </View>
        </View>

        {/* Decibel Chart */}
        {hasDecibelData ? (
          <View
            style={[
              styles.card,
              { backgroundColor: isDark ? '#1E1E1E' : '#F8F9FA' },
            ]}
          >
            <ThemedText style={styles.cardTitle}>分贝曲线</ThemedText>
            <View style={styles.chartLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#6C63FF' }]} />
                <ThemedText style={styles.legendText}>正常</ThemedText>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#F44336' }]} />
                <ThemedText style={styles.legendText}>超阈值 ({'>='}{threshold}dB)</ThemedText>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendLine, { backgroundColor: '#FF9800' }]} />
                <ThemedText style={styles.legendText}>阈值线</ThemedText>
              </View>
            </View>
            <DecibelChart
              data={decibelData}
              snoreEvents={dynamicSnoreEvents}
              height={150}
              showThreshold={true}
              highlightSnoring={true}
              currentPosition={status?.playing ? playbackPosition : undefined}
              threshold={threshold}
              onSnoreEventPress={handleSeekToEvent}
            />
            <ThemedText style={styles.chartHint}>点击红色区域可跳转播放</ThemedText>

            {/* 阈值调节 */}
            <View style={styles.thresholdContainer}>
              <View style={styles.thresholdHeader}>
                <ThemedText style={styles.thresholdLabel}>打鼾阈值</ThemedText>
                <ThemedText style={styles.thresholdValue}>{threshold} dB</ThemedText>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={20}
                maximumValue={80}
                step={1}
                value={threshold}
                onValueChange={setThreshold}
                onSlidingComplete={async (value) => {
                  if (recording) {
                    // 使用新阈值重新分析数据
                    const newAnalysis = analyzeDecibelData(recording.decibelData, value);
                    await updateRecording(recording.id, { 
                      threshold: value,
                      analysis: newAnalysis,
                    });
                    // 重新加载以更新显示
                    await loadRecording();
                  }
                }}
                minimumTrackTintColor="#6C63FF"
                maximumTrackTintColor={isDark ? '#333' : '#E0E0E0'}
                thumbTintColor="#6C63FF"
              />
              <View style={styles.thresholdHints}>
                <ThemedText style={styles.thresholdHint}>安静 20</ThemedText>
                <ThemedText style={styles.thresholdHint}>80 嘈杂</ThemedText>
              </View>
            </View>

            {/* 动态统计 */}
            <View style={styles.dynamicStats}>
              <ThemedText style={styles.dynamicStatsText}>
                当前阈值下检测到 <ThemedText style={styles.dynamicStatsHighlight}>{dynamicSnoreEvents.length}</ThemedText> 次打鼾事件
              </ThemedText>
            </View>
          </View>
        ) : (
          <View
            style={[
              styles.card,
              { backgroundColor: isDark ? '#1E1E1E' : '#F8F9FA' },
            ]}
          >
            <ThemedText style={styles.cardTitle}>分贝曲线</ThemedText>
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

        {/* Playback Controls */}
        <View
          style={[
            styles.card,
            { backgroundColor: isDark ? '#1E1E1E' : '#F8F9FA' },
          ]}
        >
          <ThemedText style={styles.cardTitle}>播放控制</ThemedText>
          <View style={styles.playbackContainer}>
            <TouchableOpacity
              style={[styles.playButton, { backgroundColor: '#6C63FF' }]}
              onPress={handlePlayPause}
              activeOpacity={0.8}
              disabled={!isPlayerReady}
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
            <View style={styles.playbackInfo}>
              <ThemedText style={styles.playbackTime}>
                {formatDuration(playbackPosition)} / {formatDuration(actualDuration)}
              </ThemedText>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${actualDuration > 0 ? Math.min((playbackPosition / actualDuration) * 100, 100) : 0}%`,
                      backgroundColor: '#6C63FF',
                    },
                  ]}
                />
              </View>
            </View>
          </View>
        </View>

        {/* Analysis Section */}
        <View
          style={[
            styles.card,
            { backgroundColor: isDark ? '#1E1E1E' : '#F8F9FA' },
          ]}
        >
          <ThemedText style={styles.cardTitle}>打鼾分析</ThemedText>

          {analysis ? (
            <View style={styles.analysisContent}>
              <View
                style={[
                  styles.severityBadge,
                  { backgroundColor: getSeverityColor(analysis.severity) },
                ]}
              >
                <ThemedText style={styles.severityText}>
                  {getSeverityText(analysis.severity)}
                </ThemedText>
              </View>

              <View style={styles.analysisStats}>
                <View style={styles.statItem}>
                  <ThemedText style={styles.statValue}>
                    {analysis.snoreCount}
                  </ThemedText>
                  <ThemedText style={styles.statLabel}>打鼾次数</ThemedText>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <ThemedText style={styles.statValue}>
                    {Math.floor(analysis.snoreDuration / 60)}分{analysis.snoreDuration % 60}秒
                  </ThemedText>
                  <ThemedText style={styles.statLabel}>打鼾时长</ThemedText>
                </View>
              </View>

              <View style={styles.decibelStats}>
                <View style={styles.decibelStatItem}>
                  <ThemedText style={styles.decibelStatValue}>{analysis.avgDecibel}</ThemedText>
                  <ThemedText style={styles.decibelStatLabel}>平均分贝</ThemedText>
                </View>
                <View style={styles.decibelStatItem}>
                  <ThemedText style={styles.decibelStatValue}>{analysis.maxDecibel}</ThemedText>
                  <ThemedText style={styles.decibelStatLabel}>最大分贝</ThemedText>
                </View>
                {analysis.hasSnoring && (
                  <View style={styles.decibelStatItem}>
                    <ThemedText style={[styles.decibelStatValue, { color: '#F44336' }]}>
                      {analysis.avgSnoringDecibel}
                    </ThemedText>
                    <ThemedText style={styles.decibelStatLabel}>打鼾均值</ThemedText>
                  </View>
                )}
              </View>

              {analysis.hasSnoring && (
                <View style={styles.tips}>
                  <ThemedText style={styles.tipsTitle}>健康建议</ThemedText>
                  <ThemedText style={styles.tipsText}>
                    {analysis.severity === 'severe'
                      ? '您的打鼾较为严重，建议咨询医生了解是否存在睡眠呼吸暂停症状。考虑进行专业的睡眠监测。'
                      : analysis.severity === 'moderate'
                      ? '您有中度打鼾，建议保持侧卧睡姿，避免睡前饮酒，保持健康体重。'
                      : '您的打鼾较轻，保持良好的睡眠习惯即可。建议规律作息，保持适度运动。'}
                  </ThemedText>
                </View>
              )}

              <ThemedText style={styles.analysisTime}>
                分析时间: {formatDate(analysis.analyzedAt)}
              </ThemedText>

              {hasDecibelData && (
                <TouchableOpacity
                  style={[styles.reanalyzeButton, { borderColor: '#6C63FF' }]}
                  onPress={handleAnalyze}
                  disabled={isAnalyzing}
                >
                  {isAnalyzing ? (
                    <ActivityIndicator size="small" color="#6C63FF" />
                  ) : (
                    <ThemedText style={[styles.reanalyzeText, { color: '#6C63FF' }]}>
                      重新分析
                    </ThemedText>
                  )}
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.noAnalysis}>
              {hasDecibelData ? (
                <>
                  <ThemedText style={styles.noAnalysisText}>
                    尚未分析此录音
                  </ThemedText>
                  <TouchableOpacity
                    style={[styles.analyzeButton, { backgroundColor: '#6C63FF' }]}
                    onPress={handleAnalyze}
                    disabled={isAnalyzing}
                    activeOpacity={0.8}
                  >
                    {isAnalyzing ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <ThemedText style={styles.analyzeButtonText}>
                        开始分析
                      </ThemedText>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <ThemedText style={styles.noAnalysisText}>
                    无法分析此录音
                  </ThemedText>
                  <ThemedText style={styles.noDataSubtext}>
                    此录音没有分贝数据，无法进行打鼾分析
                  </ThemedText>
                </>
              )}
            </View>
          )}
        </View>

        {/* Snore Events Timeline - 使用动态计算的事件 */}
        {dynamicSnoreEvents.length > 0 && (
          <View
            style={[
              styles.card,
              { backgroundColor: isDark ? '#1E1E1E' : '#F8F9FA' },
            ]}
          >
            <ThemedText style={styles.cardTitle}>
              打鼾事件 ({dynamicSnoreEvents.length})
            </ThemedText>
            <ThemedText style={styles.eventsHint}>点击事件可跳转播放</ThemedText>
            <View style={styles.eventsContainer}>
              {dynamicSnoreEvents.slice(0, 10).map((event, index) => (
                <TouchableOpacity 
                  key={index} 
                  style={styles.eventItem}
                  onPress={() => handleSeekToEvent(event)}
                  activeOpacity={0.7}
                >
                  <View style={styles.eventTime}>
                    <ThemedText style={styles.eventTimeText}>
                      {formatDuration(event.startTime)}
                    </ThemedText>
                    <ThemedText style={styles.eventDash}>-</ThemedText>
                    <ThemedText style={styles.eventTimeText}>
                      {formatDuration(event.endTime)}
                    </ThemedText>
                  </View>
                  <View style={styles.eventDetails}>
                    <ThemedText style={styles.eventDuration}>
                      {Math.round((event.endTime - event.startTime) / 1000)}秒
                    </ThemedText>
                    <View style={[styles.eventDecibel, { backgroundColor: '#F44336' + '20' }]}>
                      <ThemedText style={[styles.eventDecibelText, { color: '#F44336' }]}>
                        {event.maxDecibel}dB
                      </ThemedText>
                    </View>
                    <View style={styles.eventPlayIcon}>
                      <ThemedText style={styles.eventPlayIconText}>▶</ThemedText>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
              {dynamicSnoreEvents.length > 10 && (
                <ThemedText style={styles.moreEvents}>
                  还有 {dynamicSnoreEvents.length - 10} 个事件...
                </ThemedText>
              )}
            </View>
          </View>
        )}

        {/* Delete Button */}
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDelete}
          activeOpacity={0.8}
        >
          <ThemedText style={styles.deleteButtonText}>删除录音</ThemedText>
        </TouchableOpacity>

        {/* Export Button */}
        <TouchableOpacity
          style={styles.exportButton}
          onPress={handleExport}
          activeOpacity={0.8}
        >
          <ThemedText style={styles.exportButtonText}>导出录音</ThemedText>
        </TouchableOpacity>
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
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  infoLabel: {
    fontSize: 15,
    opacity: 0.6,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '600',
  },
  noDataContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  noDataText: {
    fontSize: 16,
    opacity: 0.5,
  },
  noDataSubtext: {
    fontSize: 14,
    opacity: 0.4,
    marginTop: 8,
  },
  chartLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
    gap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  legendLine: {
    width: 16,
    height: 3,
    borderRadius: 1,
    marginRight: 6,
  },
  legendText: {
    fontSize: 12,
    opacity: 0.7,
  },
  playbackContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    width: 0,
    height: 0,
    borderLeftWidth: 16,
    borderTopWidth: 10,
    borderBottomWidth: 10,
    borderLeftColor: '#FFFFFF',
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    marginLeft: 4,
  },
  pauseIcon: {
    flexDirection: 'row',
    gap: 6,
  },
  pauseBar: {
    width: 6,
    height: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
  },
  playbackInfo: {
    flex: 1,
    marginLeft: 16,
  },
  playbackTime: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  progressBar: {
    height: 6,
    backgroundColor: 'rgba(108, 99, 255, 0.2)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  analysisContent: {
    alignItems: 'center',
  },
  severityBadge: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    marginBottom: 24,
  },
  severityText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  analysisStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  statItem: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 14,
    opacity: 0.6,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(128, 128, 128, 0.3)',
  },
  decibelStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.2)',
    marginBottom: 20,
  },
  decibelStatItem: {
    alignItems: 'center',
  },
  decibelStatValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  decibelStatLabel: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 4,
  },
  tips: {
    width: '100%',
    padding: 16,
    backgroundColor: 'rgba(108, 99, 255, 0.1)',
    borderRadius: 12,
    marginBottom: 16,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    color: '#6C63FF',
  },
  tipsText: {
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.8,
  },
  analysisTime: {
    fontSize: 12,
    opacity: 0.5,
    marginBottom: 16,
  },
  reanalyzeButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 2,
  },
  reanalyzeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  noAnalysis: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  noAnalysisText: {
    fontSize: 16,
    opacity: 0.5,
    marginBottom: 20,
  },
  analyzeButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 28,
  },
  analyzeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  eventsContainer: {
    gap: 8,
  },
  eventItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128, 128, 128, 0.1)',
  },
  eventTime: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventTimeText: {
    fontSize: 14,
    fontWeight: '500',
  },
  eventDash: {
    marginHorizontal: 4,
    opacity: 0.5,
  },
  eventDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  eventDuration: {
    fontSize: 14,
    opacity: 0.6,
  },
  eventDecibel: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  eventDecibelText: {
    fontSize: 12,
    fontWeight: '600',
  },
  moreEvents: {
    fontSize: 14,
    opacity: 0.5,
    textAlign: 'center',
    marginTop: 8,
  },
  deleteButton: {
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#F44336',
  },
  deleteButtonText: {
    color: '#F44336',
    fontSize: 16,
    fontWeight: '600',
  },
  exportButton: {
    backgroundColor: 'rgba(108, 99, 255, 0.1)',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#6C63FF',
  },
  exportButtonText: {
    color: '#6C63FF',
    fontSize: 16,
    fontWeight: '600',
  },
  chartHint: {
    fontSize: 12,
    opacity: 0.5,
    textAlign: 'center',
    marginTop: 8,
  },
  thresholdContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128, 128, 128, 0.2)',
  },
  thresholdHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  thresholdLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  thresholdValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6C63FF',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  thresholdHints: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -8,
  },
  thresholdHint: {
    fontSize: 12,
    opacity: 0.5,
  },
  dynamicStats: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128, 128, 128, 0.2)',
    alignItems: 'center',
  },
  dynamicStatsText: {
    fontSize: 14,
    opacity: 0.8,
  },
  dynamicStatsHighlight: {
    fontWeight: '700',
    color: '#F44336',
  },
  eventsHint: {
    fontSize: 12,
    opacity: 0.5,
    marginBottom: 12,
  },
  eventPlayIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(108, 99, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  eventPlayIconText: {
    fontSize: 10,
    color: '#6C63FF',
  },
});
