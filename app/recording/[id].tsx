import { useCallback, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Audio } from 'expo-av';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import {
  Recording,
  getRecording,
  updateRecording,
  formatDuration,
  formatDate,
} from '@/utils/storage';
import {
  analyzeSnoring,
  getSeverityColor,
  getSeverityText,
} from '@/utils/analysis';

export default function RecordingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playbackPosition, setPlaybackPosition] = useState(0);

  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  const loadRecording = useCallback(async () => {
    if (id) {
      const data = await getRecording(id);
      setRecording(data);
    }
  }, [id]);

  useEffect(() => {
    loadRecording();
  }, [loadRecording]);

  useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [sound]);

  const handlePlayPause = async () => {
    if (!recording) return;

    try {
      if (isPlaying && sound) {
        await sound.pauseAsync();
        setIsPlaying(false);
      } else {
        if (sound) {
          await sound.playAsync();
          setIsPlaying(true);
        } else {
          const { sound: newSound } = await Audio.Sound.createAsync(
            { uri: recording.uri },
            { shouldPlay: true },
            (status) => {
              if (status.isLoaded) {
                setPlaybackPosition(status.positionMillis);
                if (status.didJustFinish) {
                  setIsPlaying(false);
                  setPlaybackPosition(0);
                }
              }
            }
          );
          setSound(newSound);
          setIsPlaying(true);
        }
      }
    } catch (error) {
      console.error('Playback error:', error);
      Alert.alert('错误', '无法播放录音');
    }
  };

  const handleAnalyze = async () => {
    if (!recording || isAnalyzing) return;

    setIsAnalyzing(true);
    try {
      const analysis = await analyzeSnoring(recording.uri);
      await updateRecording(recording.id, { analysis });
      await loadRecording();
    } catch (error) {
      console.error('Analysis error:', error);
      Alert.alert('错误', '分析失败，请重试');
    } finally {
      setIsAnalyzing(false);
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
            { backgroundColor: colorScheme === 'dark' ? '#1E1E1E' : '#F8F9FA' },
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
        </View>

        {/* Playback Controls */}
        <View
          style={[
            styles.card,
            { backgroundColor: colorScheme === 'dark' ? '#1E1E1E' : '#F8F9FA' },
          ]}
        >
          <ThemedText style={styles.cardTitle}>播放控制</ThemedText>
          <View style={styles.playbackContainer}>
            <TouchableOpacity
              style={[styles.playButton, { backgroundColor: '#6C63FF' }]}
              onPress={handlePlayPause}
              activeOpacity={0.8}
            >
              {isPlaying ? (
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
                {formatDuration(playbackPosition)} / {formatDuration(recording.duration)}
              </ThemedText>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${(playbackPosition / recording.duration) * 100}%`,
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
            { backgroundColor: colorScheme === 'dark' ? '#1E1E1E' : '#F8F9FA' },
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

              {analysis.hasSnoring && (
                <View style={styles.tips}>
                  <ThemedText style={styles.tipsTitle}>建议</ThemedText>
                  <ThemedText style={styles.tipsText}>
                    {analysis.severity === 'severe'
                      ? '您的打鼾较为严重，建议咨询医生了解是否存在睡眠呼吸暂停症状。'
                      : analysis.severity === 'moderate'
                      ? '您有中度打鼾，建议保持侧卧睡姿，避免睡前饮酒。'
                      : '您的打鼾较轻，保持良好的睡眠习惯即可。'}
                  </ThemedText>
                </View>
              )}

              <ThemedText style={styles.analysisTime}>
                分析时间: {formatDate(analysis.analyzedAt)}
              </ThemedText>

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
            </View>
          ) : (
            <View style={styles.noAnalysis}>
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
            </View>
          )}
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
    marginBottom: 24,
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
});
