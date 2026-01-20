import { useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  Animated,
} from 'react-native';
import { File, Paths } from 'expo-file-system';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LiveWaveform } from '@/components/decibel-chart';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRecording } from '@/hooks/use-recording';
import { Colors } from '@/constants/theme';
import {
  Recording as RecordingData,
  getRecordings,
  saveRecording,
  deleteRecording,
  formatDuration,
  formatDate,
  analyzeDecibelData,
  SNORE_THRESHOLD_DB,
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

export default function HomeScreen() {
  const [recordings, setRecordings] = useState<RecordingData[]>([]);
  
  const {
    isRecording,
    currentDecibel,
    decibelData,
    duration,
    startRecording,
    stopRecording,
    error,
  } = useRecording();
  
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === 'dark';

  const loadRecordings = useCallback(async () => {
    const data = await getRecordings();
    setRecordings(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRecordings();
    }, [loadRecordings])
  );

  const handleStartRecording = async () => {
    await startRecording();
  };

  const handleStopRecording = async () => {
    const result = await stopRecording();
    
    if (result) {
      // 移动文件到永久存储
      const fileName = `recording_${Date.now()}.m4a`;
      const sourceFile = new File(result.uri);
      const destFile = new File(Paths.document, fileName);
      
      try {
        sourceFile.move(destFile);
        
        // 自动分析分贝数据
        const analysis = analyzeDecibelData(result.decibelData);
        
        const newRecording: RecordingData = {
          id: Date.now().toString(36) + Math.random().toString(36).substr(2),
          uri: destFile.uri,
          createdAt: Date.now(),
          duration: duration,
          decibelData: result.decibelData,
          analysis,
        };

        await saveRecording(newRecording);
        await loadRecordings();
      } catch (err) {
        console.error('Failed to save recording:', err);
        Alert.alert('错误', '无法保存录音');
      }
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert('删除录音', '确定要删除这条录音吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteRecording(id);
          await loadRecordings();
        },
      },
    ]);
  };

  const isSnoring = currentDecibel >= SNORE_THRESHOLD_DB;

  const renderRecordingItem = ({ item }: { item: RecordingData }) => (
    <TouchableOpacity
      style={[styles.recordingItem, { backgroundColor: isDark ? '#1E1E1E' : '#F8F9FA' }]}
      onPress={() => router.push(`/recording/${item.id}` as any)}
      onLongPress={() => handleDelete(item.id)}
    >
      <View style={styles.recordingInfo}>
        <ThemedText style={styles.recordingDate}>{formatDate(item.createdAt)}</ThemedText>
        <ThemedText style={styles.recordingDuration}>
          {formatDuration(item.duration)}
        </ThemedText>
      </View>
      {item.analysis ? (
        <View style={[styles.analysisTag, { backgroundColor: getSeverityColor(item.analysis.severity) }]}>
          <ThemedText style={styles.analysisTagText}>
            {getSeverityText(item.analysis.severity)}
          </ThemedText>
        </View>
      ) : (
        <View style={[styles.analysisTag, { backgroundColor: '#9E9E9E' }]}>
          <ThemedText style={styles.analysisTagText}>待分析</ThemedText>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ThemedText style={styles.title}>睡眠记录</ThemedText>
        <ThemedText style={styles.subtitle}>
          记录您的睡眠，分析打鼾情况
        </ThemedText>
      </View>

      {isRecording && (
        <View style={[styles.recordingStatus, { backgroundColor: isDark ? '#1E1E1E' : '#F8F9FA' }]}>
          {/* 实时分贝显示 */}
          <View style={styles.decibelDisplay}>
            <View style={styles.decibelHeader}>
              <View style={[styles.recordingDot, { backgroundColor: isSnoring ? '#F44336' : '#4CAF50' }]} />
              <ThemedText style={styles.recordingTimeText}>
                {formatDuration(duration)}
              </ThemedText>
            </View>
            
            <View style={styles.decibelValueContainer}>
              <ThemedText style={[styles.decibelValue, { color: isSnoring ? '#F44336' : '#6C63FF' }]}>
                {Math.round(currentDecibel)}
              </ThemedText>
              <ThemedText style={styles.decibelUnit}>dB</ThemedText>
            </View>
            
            {isSnoring && (
              <View style={styles.snoringAlert}>
                <ThemedText style={styles.snoringAlertText}>检测到打鼾</ThemedText>
              </View>
            )}
          </View>
          
          {/* 实时波形图 */}
          <View style={styles.waveformContainer}>
            <LiveWaveform recentData={decibelData} height={50} />
          </View>
          
          {/* 统计信息 */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <ThemedText style={styles.statValue}>{decibelData.filter(d => d.isSnoring).length}</ThemedText>
              <ThemedText style={styles.statLabel}>打鼾次数</ThemedText>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <ThemedText style={styles.statValue}>
                {Math.round(decibelData.length > 0 ? decibelData.reduce((a, b) => a + b.decibel, 0) / decibelData.length : 0)}
              </ThemedText>
              <ThemedText style={styles.statLabel}>平均分贝</ThemedText>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <ThemedText style={styles.statValue}>
                {Math.max(...decibelData.map(d => d.decibel), 0)}
              </ThemedText>
              <ThemedText style={styles.statLabel}>最大分贝</ThemedText>
            </View>
          </View>
        </View>
      )}

      {error && (
        <View style={styles.errorContainer}>
          <ThemedText style={styles.errorText}>{error}</ThemedText>
        </View>
      )}

      <FlatList
        data={recordings}
        renderItem={renderRecordingItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <ThemedText style={styles.emptyText}>
              还没有录音记录
            </ThemedText>
            <ThemedText style={styles.emptySubtext}>
              点击下方按钮开始录制睡眠音频
            </ThemedText>
          </View>
        }
      />

      <View style={[styles.buttonContainer, { paddingBottom: insets.bottom + 20 }]}>
        <TouchableOpacity
          style={[
            styles.recordButton,
            isRecording ? styles.recordButtonStop : styles.recordButtonStart,
          ]}
          onPress={isRecording ? handleStopRecording : handleStartRecording}
          activeOpacity={0.8}
        >
          {isRecording ? (
            <View style={styles.stopIcon} />
          ) : (
            <View style={styles.micIcon}>
              <View style={styles.micBody} />
              <View style={styles.micBase} />
            </View>
          )}
        </TouchableOpacity>
        <ThemedText style={styles.buttonLabel}>
          {isRecording ? '停止录音' : '开始录音'}
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.6,
    marginTop: 4,
  },
  recordingStatus: {
    marginHorizontal: 24,
    marginVertical: 8,
    borderRadius: 16,
    padding: 16,
  },
  decibelDisplay: {
    alignItems: 'center',
    marginBottom: 12,
  },
  decibelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  recordingTimeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  decibelValueContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  decibelValue: {
    fontSize: 48,
    fontWeight: '700',
    lineHeight: 56,
  },
  decibelUnit: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
    marginLeft: 4,
    opacity: 0.6,
  },
  snoringAlert: {
    backgroundColor: 'rgba(244, 67, 54, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 4,
  },
  snoringAlertText: {
    color: '#F44336',
    fontSize: 12,
    fontWeight: '600',
  },
  waveformContainer: {
    marginVertical: 12,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128, 128, 128, 0.2)',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(128, 128, 128, 0.2)',
  },
  errorContainer: {
    marginHorizontal: 24,
    padding: 12,
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
    borderRadius: 8,
    marginBottom: 8,
  },
  errorText: {
    color: '#F44336',
    fontSize: 14,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 200,
  },
  recordingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  recordingInfo: {
    flex: 1,
  },
  recordingDate: {
    fontSize: 16,
    fontWeight: '600',
  },
  recordingDuration: {
    fontSize: 14,
    opacity: 0.6,
    marginTop: 4,
  },
  analysisTag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  analysisTagText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    opacity: 0.5,
  },
  emptySubtext: {
    fontSize: 14,
    opacity: 0.4,
    marginTop: 8,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: 20,
    backgroundColor: 'transparent',
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  recordButtonStart: {
    backgroundColor: '#6C63FF',
  },
  recordButtonStop: {
    backgroundColor: '#F44336',
  },
  stopIcon: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  micIcon: {
    alignItems: 'center',
  },
  micBody: {
    width: 16,
    height: 24,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  micBase: {
    width: 24,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
    marginTop: 4,
  },
  buttonLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
    opacity: 0.8,
  },
});
