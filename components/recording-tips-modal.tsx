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
import { useTheme } from '@/hooks/use-theme';
import { Palette, Spacing, Radius, FontSize } from '@/constants/theme';
import i18n from '@/i18n';

interface RecordingTipsModalProps {
  visible: boolean;
  onClose: () => void;
  onStartRecording: () => void;
}

const TIPS = [
  { icon: 'battery-charging' as const, key: 'home.tipCharging' },
  { icon: 'bed' as const, key: 'home.tipPosition' },
  { icon: 'moon' as const, key: 'home.tipScreenOff' },
];

export function RecordingTipsModal({ visible, onClose, onStartRecording }: RecordingTipsModalProps) {
  const { colors } = useTheme();

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
        <ThemedView style={[styles.container, { backgroundColor: colors.surface }]}>
          {/* 关闭按钮 */}
          <TouchableOpacity
            style={[styles.closeButton, { backgroundColor: colors.surfaceSunken }]}
            onPress={onClose}
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
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
            {TIPS.map((tip) => (
              <View key={tip.icon} style={styles.tipItem}>
                <View style={[styles.tipIcon, { backgroundColor: colors.brandSoft }]}>
                  <Ionicons name={tip.icon} size={18} color={colors.brand} />
                </View>
                <ThemedText style={styles.tipText}>{i18n.t(tip.key)}</ThemedText>
              </View>
            ))}
          </View>

          {/* 开始录音按钮 */}
          <TouchableOpacity style={styles.startButton} onPress={handleStart} activeOpacity={0.85}>
            <Ionicons name="mic" size={18} color="#FFFFFF" />
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
    padding: Spacing.xl,
  },
  container: {
    width: '100%',
    maxWidth: 400,
    maxHeight: 560,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: Spacing.lg,
    right: Spacing.lg,
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    marginBottom: Spacing.xl,
    marginTop: Spacing.xs,
  },
  image: {
    width: '100%',
    aspectRatio: 1.4,
    maxHeight: 200,
    marginBottom: Spacing.xl,
  },
  tipsContainer: {
    width: '100%',
    gap: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  tipIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tipText: {
    fontSize: FontSize.md,
    flex: 1,
  },
  startButton: {
    flexDirection: 'row',
    gap: Spacing.sm,
    backgroundColor: Palette.brand,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xxl,
    borderRadius: Radius.md,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: FontSize.md,
    fontWeight: '600',
  },
});
