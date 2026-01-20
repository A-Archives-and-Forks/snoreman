import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  Animated,
} from 'react-native';
import { Audio } from 'expo-av';
import { File, Paths } from 'expo-file-system';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import {
  Recording as RecordingData,
  getRecordings,
  saveRecording,
  deleteRecording,
  formatDuration,
  formatDate,
  generateId,
} from '@/utils/storage';
import { getSeverityColor, getSeverityText } from '@/utils/analysis';

export default function HomeScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordings, setRecordings] = useState<RecordingData[]>([]);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  const loadRecordings = useCallback(async () => {
    const data = await getRecordings();
    setRecordings(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRecordings();
    }, [loadRecordings])
  );

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording, pulseAnim]);

  const startRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('需要权限', '请允许使用麦克风来录制睡眠音频');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingDuration(0);

      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1000);
      }, 1000);
    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('错误', '无法开始录音');
    }
  };

  const stopRecording = async () => {
    try {
      if (!recordingRef.current) return;

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setIsRecording(false);

      if (uri) {
        // Move to permanent storage
        const fileName = `recording_${Date.now()}.m4a`;
        const sourceFile = new File(uri);
        const destFile = new File(Paths.document, fileName);
        sourceFile.move(destFile);

        const newRecording: RecordingData = {
          id: generateId(),
          uri: destFile.uri,
          createdAt: Date.now(),
          duration: recordingDuration,
        };

        await saveRecording(newRecording);
        await loadRecordings();
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      });
    } catch (error) {
      console.error('Failed to stop recording:', error);
      Alert.alert('错误', '无法保存录音');
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

  const renderRecordingItem = ({ item }: { item: RecordingData }) => (
    <TouchableOpacity
      style={[styles.recordingItem, { backgroundColor: colorScheme === 'dark' ? '#1E1E1E' : '#F8F9FA' }]}
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
        <View style={styles.recordingStatus}>
          <Animated.View
            style={[
              styles.recordingDot,
              { transform: [{ scale: pulseAnim }] },
            ]}
          />
          <ThemedText style={styles.recordingText}>
            正在录音 {formatDuration(recordingDuration)}
          </ThemedText>
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
          onPress={isRecording ? stopRecording : startRecording}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
    marginHorizontal: 24,
    marginVertical: 8,
    borderRadius: 12,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F44336',
    marginRight: 8,
  },
  recordingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F44336',
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
