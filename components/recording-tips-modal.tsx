import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Image,
} from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import i18n from '@/i18n';

interface RecordingTipsModalProps {
  visible: boolean;
  onClose: () => void;
  onStartRecording: () => void;
}

export function RecordingTipsModal({ visible, onClose, onStartRecording }: RecordingTipsModalProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const handleStart = () => {
    onClose();
    onStartRecording();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <ThemedView style={[styles.container, { backgroundColor: isDark ? '#1E1E1E' : '#FFFFFF' }]}>
          {/* 关闭按钮 */}
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color={isDark ? '#fff' : '#333'} />
          </TouchableOpacity>

          {/* 标题 */}
          <ThemedText style={styles.title}>{i18n.t('home.recordingTips')}</ThemedText>

          {/* 插画 */}
          <Image
            source={require('@/assets/images/recording-tips.png')}
            style={styles.image}
            resizeMode="contain"
          />

          {/* 使用建议 */}
          <View style={styles.tipsContainer}>
            <View style={styles.tipItem}>
              <View style={[styles.tipIcon, { backgroundColor: '#6C63FF' }]}>
                <Ionicons name="battery-charging" size={20} color="#FFFFFF" />
              </View>
              <ThemedText style={styles.tipText}>{i18n.t('home.tipCharging')}</ThemedText>
            </View>
            <View style={styles.tipItem}>
              <View style={[styles.tipIcon, { backgroundColor: '#6C63FF' }]}>
                <Ionicons name="bed" size={20} color="#FFFFFF" />
              </View>
              <ThemedText style={styles.tipText}>{i18n.t('home.tipPosition')}</ThemedText>
            </View>
            <View style={styles.tipItem}>
              <View style={[styles.tipIcon, { backgroundColor: '#6C63FF' }]}>
                <Ionicons name="moon" size={20} color="#FFFFFF" />
              </View>
              <ThemedText style={styles.tipText}>{i18n.t('home.tipScreenOff')}</ThemedText>
            </View>
          </View>

          {/* 开始录音按钮 */}
          <TouchableOpacity style={styles.startButton} onPress={handleStart}>
            <ThemedText style={styles.startButtonText}>{i18n.t('home.startRecording')}</ThemedText>
          </TouchableOpacity>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 400,
    maxHeight: 550,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 20,
    marginTop: 8,
  },
  image: {
    width: '100%',
    aspectRatio: 1.4,
    maxHeight: 200,
    marginBottom: 24,
  },
  tipsContainer: {
    width: '100%',
    gap: 16,
    marginBottom: 24,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tipIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tipText: {
    fontSize: 15,
    flex: 1,
  },
  startButton: {
    backgroundColor: '#6C63FF',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
