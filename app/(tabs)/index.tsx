import { useCallback, useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  Animated,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Swipeable } from 'react-native-gesture-handler';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LiveWaveform } from '@/components/decibel-chart';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRecording } from '@/hooks/use-recording';
import { Colors } from '@/constants/theme';
import {
  Recording as RecordingData,
  RecordingMeta,
  getRecordingsMeta,
  saveRecording,
  deleteRecording,
  formatDuration,
  formatDate,
  analyzeDecibelData,
  SNORE_THRESHOLD_DB,
  getSnoreThreshold,
  saveSnoreThreshold,
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
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [threshold, setThreshold] = useState(SNORE_THRESHOLD_DB);
  
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
    const data = await getRecordingsMeta();
    setRecordings(data);
  }, []);

  // 组件首次挂载时加载保存的阈值设置
  useEffect(() => {
    const loadThreshold = async () => {
      const savedThreshold = await getSnoreThreshold();
      console.log('Loaded threshold:', savedThreshold);
      setThreshold(savedThreshold);
    };
    loadThreshold();
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
    console.log('handleStopRecording called, duration:', duration);
    
    try {
      const result = await stopRecording();
      console.log('stopRecording result:', result);
      
      if (result && result.uri) {
        // 保存当前 duration，因为 stopRecording 后 hook 的 duration 会被重置
        const recordingDuration = duration;
        
        // 生成唯一的录音 ID
        const recordingId = Date.now().toString(36) + Math.random().toString(36).substr(2);
        
        // expo-audio 的 recorder.uri 每次可能返回相同的缓存路径
        // 必须复制到永久存储位置，使用唯一文件名
        let finalUri = result.uri;
        
        try {
          const sourceFile = new File(result.uri);
          if (sourceFile.exists) {
            // 创建唯一的文件名
            const uniqueFileName = `recording_${Date.now()}_${recordingId}.m4a`;
            // 使用 document 目录来永久保存（cache 目录可能被系统清理）
            const destFile = new File(Paths.document, uniqueFileName);
            
            // 复制文件
            sourceFile.copy(destFile);
            finalUri = destFile.uri;
            console.log('Recording copied to:', finalUri, 'Size:', sourceFile.size, 'bytes');
          } else {
            console.warn('Source file does not exist:', result.uri);
          }
        } catch (copyError) {
          console.warn('Failed to copy recording file, using original URI:', copyError);
          // 如果复制失败，继续使用原始 URI
        }
        
        console.log('Final Recording URI:', finalUri);
        
        // 使用当前阈值分析分贝数据
        const analysis = analyzeDecibelData(result.decibelData, threshold);
        console.log('Analysis result:', analysis);
        
        const newRecording: RecordingData = {
          id: recordingId,
          uri: finalUri,
          createdAt: Date.now(),
          duration: recordingDuration > 0 ? recordingDuration : 1000,
          decibelData: result.decibelData,
          analysis,
          threshold, // 保存当前阈值
        };

        console.log('Saving recording:', newRecording.id, 'URI:', newRecording.uri);
        await saveRecording(newRecording);
        console.log('Recording saved, reloading list');
        await loadRecordings();
        console.log('List reloaded');
      } else {
        console.log('No result from stopRecording');
        Alert.alert('提示', '录音数据为空');
      }
    } catch (err) {
      console.error('Failed to save recording:', err);
      Alert.alert('错误', '无法保存录音: ' + (err as Error).message);
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

  // 直接删除（用于滑动删除，不需要确认）
  const handleDirectDelete = async (id: string) => {
    await deleteRecording(id);
    await loadRecordings();
  };

  const isSnoring = currentDecibel >= threshold;

  // 计算基于当前阈值的打鼾次数
  const snoringCount = decibelData.filter(d => d.decibel >= threshold).length;

  // 渲染滑动删除按钮
  const renderRightActions = (
    progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
    itemId: string
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-100, 0],
      outputRange: [1, 0.5],
      extrapolate: 'clamp',
    });

    return (
      <TouchableOpacity
        style={styles.deleteAction}
        onPress={() => handleDirectDelete(itemId)}
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <ThemedText style={styles.deleteActionText}>删除</ThemedText>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  const renderRecordingItem = ({ item }: { item: RecordingMeta }) => (
    <Swipeable
      renderRightActions={(progress, dragX) => renderRightActions(progress, dragX, item.id)}
      rightThreshold={40}
    >
      <TouchableOpacity
        style={[styles.recordingItem, { backgroundColor: isDark ? '#1E1E1E' : '#F8F9FA' }]}
        onPress={() => router.push(`/recording/${item.id}` as any)}
        onLongPress={() => handleDelete(item.id)}
        activeOpacity={0.7}
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
    </Swipeable>
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
            
            <View style={[styles.snoringAlert, { opacity: isSnoring ? 1 : 0 }]}>
              <ThemedText style={styles.snoringAlertText}>检测到打鼾</ThemedText>
            </View>
          </View>
          
          {/* 实时波形图 */}
          <View style={styles.waveformContainer}>
            <LiveWaveform recentData={decibelData} height={50} threshold={threshold} />
          </View>

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
              onSlidingComplete={(value) => {
                console.log('Saving threshold:', value);
                saveSnoreThreshold(value);
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
          
          {/* 统计信息 */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <ThemedText style={styles.statValue}>{snoringCount}</ThemedText>
              <ThemedText style={styles.statLabel}>超阈值次数</ThemedText>
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
            <Ionicons name="square" size={28} color="#FFFFFF" />
          ) : (
            <Ionicons name="mic" size={32} color="#FFFFFF" />
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
    paddingTop: 36,
    paddingBottom: 30,
  },
  title: {
    paddingTop: 12,
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
    overflow: 'hidden',
  },
  decibelDisplay: {
    alignItems: 'center',
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
    overflow: 'hidden',
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
    shadowOpacity: 0.6,
    shadowRadius: 18,
    elevation: 18,
  },
  recordButtonStart: {
    backgroundColor: '#6C63FF',
  },
  recordButtonStop: {
    backgroundColor: '#F44336',
  },
  buttonLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
    opacity: 0.8,
  },
  deleteAction: {
    backgroundColor: '#F44336',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: 12,
    marginBottom: 12,
  },
  deleteActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  thresholdContainer: {
    marginTop: 12,
    paddingTop: 12,
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
});
