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
  /** 麦克风权限已授予时为 true。权限未授予时弹窗不可关闭（无 X、无返回键退出），
      用户只能点"继续"进入系统权限弹窗 —— App Store 5.1.1(iv) 要求
      权限弹窗前的自定义页面不得提供跳过/延迟授权的出口（曾因 X 按钮被拒） */
  dismissible: boolean;
  onClose: () => void;
  onStartRecording: () => void;
}

const TIPS = [
  { icon: 'battery-charging' as const, key: 'home.tipCharging' },
  { icon: 'bed' as const, key: 'home.tipPosition' },
  { icon: 'moon' as const, key: 'home.tipScreenOff' },
];

export function RecordingTipsModal({ visible, dismissible, onClose, onStartRecording }: RecordingTipsModalProps) {
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
      onRequestClose={dismissible ? onClose : () => {}}
    >
      <View style={styles.overlay}>
        <ThemedView style={[styles.container, { backgroundColor: colors.surface }]}>
          {/* 关闭按钮：仅在权限已授予后显示，见 dismissible 的注释 */}
          {dismissible && (
            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: colors.surfaceSunken }]}
              onPress={onClose}
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}

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

          {/* 继续按钮：文案必须保持中性（Continue/Next），不能写"开始录音"。
              首次点击会触发系统麦克风权限弹窗，App Store 审核指南 5.1.1(iv)
              禁止在权限弹窗前的自定义页面上使用引导授权的按钮文案（曾因此被拒）。
              同样禁止提供关闭/跳过入口，见 dismissible 的注释 */}
          <TouchableOpacity style={styles.startButton} onPress={handleStart} activeOpacity={0.85}>
            <ThemedText style={styles.startButtonText}>{i18n.t('home.tipsContinue')}</ThemedText>
            <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
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
