import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { setAudioModeAsync } from 'expo-audio';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AudioPlayerChart, AudioPlayerChartHandle } from '@/components/audio-player-chart';
import { useTheme } from '@/hooks/use-theme';
import { Ionicons } from '@expo/vector-icons';
import { Palette, Spacing, Radius, FontSize } from '@/constants/theme';
import i18n from '@/i18n';
import {
  Recording,
  SnoreAnalysis,
  DecibelDataPoint,
  getRecording,
  updateRecording,
  deleteRecording,
  formatDuration,
  SNORE_THRESHOLD_DB,
  getRecordingFile,
  needsMigration,
  migrateRecordingUri,
  loadFullRateData,
} from '@/utils/storage';
import { analyzeSnoringAuto, summarizeSnoreAnalysis, groupEventsIntoSegments, SnoreSegment } from '@/utils/snore-detection';
import { getSeverityColor, getSeverityText } from '@/utils/severity';

type AnalysisMode = 'auto' | 'manual';

export default function RecordingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [autoAnalysis, setAutoAnalysis] = useState<SnoreAnalysis | null>(null);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('auto');
  const [hasFullRate, setHasFullRate] = useState(true);
  // 高频波形数据（250ms），用于图表更精细的波形；旧录音没有时为 null
  const [fullRateData, setFullRateData] = useState<DecibelDataPoint[] | null>(null);
  const [threshold, setThreshold] = useState(SNORE_THRESHOLD_DB);
  const chartRef = useRef<AudioPlayerChartHandle>(null);

  const router = useRouter();
  const { colors, shadow } = useTheme();
  const insets = useSafeAreaInsets();

  const loadRecording = useCallback(async () => {
    if (id) {
      let data = await getRecording(id);
      
      // 懒加载迁移：如果录音使用旧格式（完整 URI），自动迁移为新格式（相对路径）
      if (data && needsMigration(data)) {
        await migrateRecordingUri(id);
        // 重新加载以获取更新后的数据
        data = await getRecording(id);
      }
      
      setRecording(data);
      // 加载录音保存的阈值，如果没有则使用默认值
      if (data?.threshold !== undefined) {
        setThreshold(data.threshold);
      }

      // 一次性读取高频数据：用于图表波形展示 + 旧录音重新分析
      const fullRate = data ? loadFullRateData(data.id) : null;
      const hasFull = !!(fullRate && fullRate.length > 0);
      setFullRateData(hasFull ? fullRate : null);
      // 旧版本录音没有高频数据，识别精度较低，需要提示用户
      setHasFullRate(hasFull);

      // 自动识别分析：新录音在保存时已生成；
      // 旧录音（阈值分析或无分析）补算一次并持久化——
      // 优先用高频数据（250ms），没有时退回每秒聚合数据
      if (data && data.decibelData.length > 0) {
        if (data.analysis?.method === 'auto') {
          setAutoAnalysis(data.analysis);
        } else {
          const source = hasFull ? fullRate! : data.decibelData;
          const auto = analyzeSnoringAuto(source, data.duration);
          setAutoAnalysis(auto);
          await updateRecording(data.id, { analysis: auto });
        }
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
      }
    };
    setupAudioMode();
  }, []);

  // 页面卸载时恢复默认屏幕方向
  useEffect(() => {
    return () => {
      // 组件卸载时解锁屏幕方向，恢复跟随系统
      ScreenOrientation.unlockAsync();
    };
  }, []);

  const handleDelete = () => {
    if (!recording) return;
    
    Alert.alert(i18n.t('recording.deleteConfirmTitle'), i18n.t('recording.deleteConfirmMessage'), [
      { text: i18n.t('home.cancel'), style: 'cancel' },
      {
        text: i18n.t('recording.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteRecording(recording.id);
            router.back();
          } catch (error) {
            Alert.alert(i18n.t('recording.delete'), i18n.t('recording.exportFailed'));
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
        Alert.alert(i18n.t('recording.exportNotSupported'), i18n.t('recording.exportNotSupported'));
        return;
      }
      
      // 使用辅助函数获取录音文件（兼容新旧格式）
      const sourceFile = getRecordingFile(recording);
      if (!sourceFile.exists) {
        Alert.alert(i18n.t('recording.fileNotFound'), i18n.t('recording.fileNotFound'));
        return;
      }
      
      // 生成友好的文件名
      const date = new Date(recording.createdAt);
      const dateStr = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;
      const timeStr = `${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}`;
      const fileNamePrefix = i18n.t('recording.exportFilePrefix');
      const fileName = `${fileNamePrefix}_${dateStr}_${timeStr}.m4a`;
      
      // 复制到临时目录并重命名
      const tempFile = new File(Paths.cache, fileName);
      sourceFile.copy(tempFile);
      
      // 分享文件
      await Sharing.shareAsync(tempFile.uri, {
        mimeType: 'audio/mp4',
        dialogTitle: i18n.t('recording.export'),
        UTI: 'public.mpeg-4-audio',
      });
      
      // 清理临时文件
      try {
        tempFile.delete();
      } catch (e) {
        // 忽略清理错误
      }
    } catch (error) {
      Alert.alert(i18n.t('recording.exportFailed'), i18n.t('recording.exportFailed'));
    }
  };

  // 把相邻的呼噜事件聚合成片段，供用户逐段播放查看
  const snoreSegments = useMemo(
    () => groupEventsIntoSegments(autoAnalysis?.snoreEvents ?? []),
    [autoAnalysis]
  );

  // 正在播放的片段下标（该行显示暂停按钮）。播放位置每 tick 都会回调，
  // 但只有下标变化时 setState 才触发重渲染
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const handlePlaybackState = useCallback((playing: boolean, positionMs: number) => {
    if (!playing) {
      setActiveSegmentIndex(null);
      return;
    }
    // 与点击片段的播放窗口一致：开始前 2 秒 ~ 结束后 1 秒
    const index = snoreSegments.findIndex(
      (s) => positionMs >= s.startTime - 2000 && positionMs < s.endTime + 1000
    );
    setActiveSegmentIndex(index >= 0 ? index : null);
  }, [snoreSegments]);

  // 点击片段：跳到片段开始前2秒播放，播放到片段结束后1秒自动停止；
  // 点击正在播放的片段则暂停
  const handleSegmentPress = useCallback((segment: SnoreSegment, isActive: boolean) => {
    if (isActive) {
      chartRef.current?.pause();
      return;
    }
    chartRef.current?.seekToAndPlay(
      Math.max(0, segment.startTime - 2000),
      segment.endTime + 1000
    );
  }, []);

  // 删除误报片段：剔除该段内的呼噜事件，重算摘要并持久化（不影响录音本身）
  const handleSegmentDelete = useCallback((segment: SnoreSegment) => {
    if (!recording || !autoAnalysis) return;
    Alert.alert(
      i18n.t('recording.removeSegmentTitle'),
      i18n.t('recording.removeSegmentMessage'),
      [
        { text: i18n.t('home.cancel'), style: 'cancel' },
        {
          text: i18n.t('recording.delete'),
          style: 'destructive',
          onPress: async () => {
            const remaining = autoAnalysis.snoreEvents.filter(
              (e) => e.startTime < segment.startTime || e.endTime > segment.endTime
            );
            const updated = summarizeSnoreAnalysis(
              remaining,
              autoAnalysis.maxDecibel,
              autoAnalysis.avgDecibel,
              recording.duration
            );
            setAutoAnalysis(updated);
            await updateRecording(recording.id, { analysis: updated });
          },
        },
      ]
    );
  }, [recording, autoAnalysis]);

  // 重新分析：从原始数据重新跑自动识别，恢复全部结果（覆盖手动删除）
  const handleReanalyze = useCallback(() => {
    if (!recording) return;
    Alert.alert(
      i18n.t('recording.reanalyzeTitle'),
      i18n.t('recording.reanalyzeMessage'),
      [
        { text: i18n.t('home.cancel'), style: 'cancel' },
        {
          text: i18n.t('recording.reanalyze'),
          onPress: async () => {
            const source = fullRateData ?? recording.decibelData;
            if (!source || source.length === 0) return;
            const fresh = analyzeSnoringAuto(source, recording.duration);
            setAutoAnalysis(fresh);
            await updateRecording(recording.id, { analysis: fresh });
          },
        },
      ]
    );
  }, [recording, fullRateData]);

  // 加载中不改导航栏标题：挂载后更新 options 会重建 iOS 26 的玻璃头部按钮（闪一下）
  if (!recording) {
    return (
      <ThemedView style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </ThemedView>
    );
  }

  const MAX_SEGMENT_ROWS = 100;
  const visibleSegments = snoreSegments.slice(0, MAX_SEGMENT_ROWS);

  const decibelData = recording.decibelData || [];
  const hasDecibelData = decibelData.length > 0;
  // 图表优先用高频波形（更精细），旧录音没有时退回每秒数据
  const waveformData = fullRateData ?? decibelData;
  // 用 reduce 而非 Math.max(...arr)：整夜数据展开成函数参数会打爆调用栈
  const maxDecibelValue = decibelData.reduce((max, d) => (d.decibel > max ? d.decibel : max), 0);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
      >
        {/* 识别模式切换：自动识别 / 手动阈值（页面级控件，置顶）*/}
        {hasDecibelData && (
          <View style={[styles.modeToggle, { backgroundColor: colors.surfaceSunken }]}>
            {(['auto', 'manual'] as AnalysisMode[]).map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.modeButton,
                  analysisMode === mode && {
                    backgroundColor: colors.surface,
                  },
                  analysisMode === mode && shadow,
                ]}
                onPress={() => setAnalysisMode(mode)}
                activeOpacity={0.7}
              >
                <ThemedText
                  style={[
                    styles.modeButtonText,
                    { color: colors.textMuted },
                    analysisMode === mode && { color: colors.brand },
                  ]}
                >
                  {i18n.t(mode === 'auto' ? 'recording.modeAuto' : 'recording.modeManual')}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* 打鼾概览摘要（自动识别模式置顶：程度 + 关键数字）*/}
        {analysisMode === 'auto' && hasDecibelData && autoAnalysis && (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
              shadow,
            ]}
          >
            <View style={[styles.severityRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.severityBadge, { backgroundColor: getSeverityColor(autoAnalysis.severity, colors) + '1F' }]}>
                <View style={[styles.severityBadgeDot, { backgroundColor: getSeverityColor(autoAnalysis.severity, colors) }]} />
                <ThemedText style={[styles.severityBadgeText, { color: getSeverityColor(autoAnalysis.severity, colors) }]}>
                  {getSeverityText(autoAnalysis.severity)}
                </ThemedText>
              </View>
              <TouchableOpacity
                style={styles.reanalyzeButton}
                onPress={handleReanalyze}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={i18n.t('recording.reanalyze')}
                accessibilityRole="button"
              >
                <Ionicons name="refresh" size={14} color={colors.brand} />
                <ThemedText style={[styles.reanalyzeText, { color: colors.brand }]}>
                  {i18n.t('recording.reanalyze')}
                </ThemedText>
              </TouchableOpacity>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <ThemedText style={styles.statValue}>
                  {autoAnalysis?.snoreCount ?? 0}
                </ThemedText>
                <ThemedText style={styles.statLabel}>{i18n.t('recording.snoreCount')}</ThemedText>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <ThemedText style={styles.statValue}>
                  {formatDuration((autoAnalysis?.snoreDuration ?? 0) * 1000)}
                </ThemedText>
                <ThemedText style={styles.statLabel}>{i18n.t('recording.snoreDuration')}</ThemedText>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <ThemedText style={styles.statValue}>
                  {maxDecibelValue}
                </ThemedText>
                <ThemedText style={styles.statLabel}>{i18n.t('recording.maxDecibel')}</ThemedText>
              </View>
            </View>
          </View>
        )}

        {/* 播放器和分贝曲线整合组件 */}
        {hasDecibelData ? (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
              shadow,
            ]}
          >
            {/* 图例说明 */}
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.brand }]} />
                <ThemedText style={[styles.legendText, { color: colors.textMuted }]}>{i18n.t('recording.legendNormal')}</ThemedText>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.danger }]} />
                <ThemedText style={[styles.legendText, { color: colors.textMuted }]}>
                  {i18n.t(analysisMode === 'auto' ? 'recording.legendSnore' : 'recording.legendOverThreshold')}
                </ThemedText>
              </View>
              {analysisMode === 'manual' && (
                <View style={styles.legendItem}>
                  <View style={[styles.legendLine, { backgroundColor: colors.severity.moderate }]} />
                  <ThemedText style={[styles.legendText, { color: colors.textMuted }]}>{i18n.t('recording.legendThreshold')} {threshold}dB</ThemedText>
                </View>
              )}
            </View>

            {/* 旧版本录音精度提示 */}
            {analysisMode === 'auto' && !hasFullRate && (
              <View style={[styles.legacyHint, { backgroundColor: colors.severity.moderate + '1A' }]}>
                <Ionicons name="information-circle-outline" size={16} color={colors.severity.moderate} />
                <ThemedText style={[styles.legacyHintText, { color: colors.textMuted }]}>
                  {i18n.t('recording.legacyHint')}
                </ThemedText>
              </View>
            )}

            {/* 图表区域 */}
            <AudioPlayerChart
              ref={chartRef}
              uri={recording.uri}
              data={waveformData}
              duration={recording.duration}
              threshold={threshold}
              height={180}
              mode={analysisMode}
              snoreEvents={autoAnalysis?.snoreEvents}
              startTime={recording.createdAt - recording.duration}
              onPlaybackState={handlePlaybackState}
              onThresholdChange={async (value) => {
                setThreshold(value);
                // 手动阈值只作为探索工具持久化阈值本身，不覆盖自动识别的分析结果
                if (recording) {
                  await updateRecording(recording.id, { threshold: value });
                }
              }}
            />

            {/* 说明文字 */}
            <ThemedText style={[styles.hintText, { color: colors.textFaint }]}>
              {i18n.t(analysisMode === 'auto' ? 'recording.hintTextAuto' : 'recording.hintText')}
            </ThemedText>
          </View>
        ) : (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
              shadow,
            ]}
          >
            <View style={styles.noDataContainer}>
              <ThemedText style={styles.noDataText}>
                {i18n.t('recording.noDataTitle')}
              </ThemedText>
              <ThemedText style={[styles.noDataSubtext, { color: colors.textFaint }]}>
                {i18n.t('recording.noDataSubtitle')}
              </ThemedText>
            </View>
          </View>
        )}

        {/* 录音统计信息（手动阈值模式）*/}
        {analysisMode === 'manual' && hasDecibelData && (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
              shadow,
            ]}
          >
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <ThemedText style={styles.statValue}>
                  {decibelData.filter(d => d.decibel >= threshold).length}
                </ThemedText>
                <ThemedText style={styles.statLabel}>{i18n.t('recording.overThresholdCount')}</ThemedText>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <ThemedText style={styles.statValue}>
                  {Math.round(decibelData.length > 0 ? decibelData.reduce((a, b) => a + b.decibel, 0) / decibelData.length : 0)}
                </ThemedText>
                <ThemedText style={styles.statLabel}>{i18n.t('recording.avgDecibel')}</ThemedText>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <ThemedText style={styles.statValue}>
                  {maxDecibelValue}
                </ThemedText>
                <ThemedText style={styles.statLabel}>{i18n.t('recording.maxDecibel')}</ThemedText>
              </View>
            </View>
          </View>
        )}

        {/* 打鼾片段列表（自动识别模式） */}
        {analysisMode === 'auto' && hasDecibelData && (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
              shadow,
            ]}
          >
            <View style={styles.segmentsHeader}>
              <ThemedText style={styles.segmentsTitle}>
                {i18n.t('recording.snoreSegments')}
                {snoreSegments.length > 0 ? ` · ${snoreSegments.length}` : ''}
              </ThemedText>
            </View>

            {snoreSegments.length === 0 ? (
              <ThemedText style={[styles.noSegmentsText, { color: colors.textFaint }]}>
                {i18n.t('recording.noSnoreDetected')}
              </ThemedText>
            ) : (
              <ScrollView
                style={styles.segmentsList}
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                {visibleSegments.map((segment, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.segmentRow,
                      index < visibleSegments.length - 1 && [styles.segmentRowBorder, { borderBottomColor: colors.border }],
                    ]}
                    onPress={() => handleSegmentPress(segment, index === activeSegmentIndex)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.segmentPlayIcon, { backgroundColor: colors.brandSoft }]}>
                      <Ionicons
                        name={index === activeSegmentIndex ? 'pause' : 'play'}
                        size={13}
                        color={colors.brand}
                      />
                    </View>
                    <View style={styles.segmentInfo}>
                      <ThemedText style={styles.segmentTime}>
                        {formatDuration(segment.startTime)}
                      </ThemedText>
                      <ThemedText style={[styles.segmentMeta, { color: colors.textMuted }]}>
                        {i18n.t('recording.segmentMeta', {
                          duration: formatDuration(segment.endTime - segment.startTime),
                          count: segment.eventCount,
                          db: segment.maxDecibel,
                        })}
                      </ThemedText>
                    </View>
                    <TouchableOpacity
                      style={styles.segmentDeleteButton}
                      onPress={() => handleSegmentDelete(segment)}
                      activeOpacity={0.6}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityLabel={i18n.t('recording.removeSegmentTitle')}
                      accessibilityRole="button"
                    >
                      <Ionicons
                        name="close-circle"
                        size={20}
                        color={colors.textFaint}
                      />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
                {snoreSegments.length > MAX_SEGMENT_ROWS && (
                  <ThemedText style={[styles.moreSegmentsText, { color: colors.textFaint }]}>
                    {i18n.t('recording.moreSegments', { count: snoreSegments.length - MAX_SEGMENT_ROWS })}
                  </ThemedText>
                )}
              </ScrollView>
            )}
          </View>
        )}

        {/* 操作按钮 */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity
            style={styles.exportButton}
            onPress={handleExport}
            activeOpacity={0.8}
            accessibilityLabel={i18n.t('recording.export')}
            accessibilityRole="button"
          >
            <ThemedText style={styles.exportButtonText}>{i18n.t('recording.export')}</ThemedText>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.deleteButton, { borderColor: colors.danger }]}
            onPress={handleDelete}
            activeOpacity={0.8}
            accessibilityLabel={i18n.t('recording.delete')}
            accessibilityRole="button"
          >
            <ThemedText style={[styles.deleteButtonText, { color: colors.danger }]}>{i18n.t('recording.delete')}</ThemedText>
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
    padding: Spacing.lg,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  modeToggle: {
    flexDirection: 'row',
    borderRadius: Radius.sm,
    padding: 3,
    marginBottom: Spacing.lg,
  },
  modeButton: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm - 2,
    alignItems: 'center',
  },
  modeButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.xl,
    marginBottom: Spacing.md,
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
    fontSize: FontSize.xs,
  },
  hintText: {
    fontSize: FontSize.xs,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  legacyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    marginBottom: Spacing.md,
  },
  legacyHintText: {
    flex: 1,
    fontSize: FontSize.xs,
    lineHeight: 16,
  },
  severityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.lg,
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
  },
  severityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  severityBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  severityBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  segmentsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  segmentsTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  reanalyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reanalyzeText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  noSegmentsText: {
    fontSize: FontSize.sm,
    textAlign: 'center',
    paddingVertical: Spacing.lg,
  },
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  segmentRowBorder: {
    borderBottomWidth: 1,
  },
  segmentPlayIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
    paddingLeft: 2,
  },
  segmentsList: {
    maxHeight: 320,
  },
  segmentInfo: {
    flex: 1,
  },
  segmentDeleteButton: {
    padding: 4,
    marginLeft: Spacing.sm,
  },
  segmentTime: {
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  segmentMeta: {
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  moreSegmentsText: {
    fontSize: FontSize.xs,
    textAlign: 'center',
    paddingTop: Spacing.md,
  },
  noDataContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noDataText: {
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
  noDataSubtext: {
    fontSize: FontSize.sm,
    marginTop: 6,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: FontSize.xxl,
    lineHeight: FontSize.xxl + 8,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: FontSize.xs,
    opacity: 0.6,
    marginTop: Spacing.xs,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(128, 128, 128, 0.18)',
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.xs,
  },
  deleteButton: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingVertical: Spacing.lg,
    borderRadius: Radius.md,
    alignItems: 'center',
    borderWidth: 1,
  },
  deleteButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  exportButton: {
    flex: 2,
    backgroundColor: Palette.brand,
    paddingVertical: Spacing.lg,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  exportButtonText: {
    color: '#FFFFFF',
    fontSize: FontSize.md,
    fontWeight: '600',
  },
});
