import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import i18n from '@/i18n';

// 录音期间在锁屏/通知栏显示的"正在录音"指示
// 固定 identifier，保证任意进程里都能按 id 关闭（含上次异常退出的残留）
const NOTIFICATION_ID = 'recording-status';
const CHANNEL_ID = 'recording-status';

// 标记通知类型，供前台通知处理器识别并抑制横幅/提示音
export const RECORDING_NOTIFICATION_TYPE = 'recording';

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Recording status',
    importance: Notifications.AndroidImportance.LOW, // 低优先级：无提示音、不弹横幅
    sound: null,
    enableVibrate: false,
    showBadge: false,
  });
}

// 显示"正在录音"通知（静音、Android 常驻不可划走）。无权限时按需申请，仍拿不到则静默跳过
export async function showRecordingNotification(): Promise<void> {
  try {
    let granted = (await Notifications.getPermissionsAsync()).granted;
    if (!granted) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return;

    await ensureChannel();

    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: i18n.t('recordingNotification.title'),
        sound: false,
        sticky: true,        // Android: 常驻、不可划走
        autoDismiss: false,  // 点击后不自动消失（录音仍在进行）
        priority: Notifications.AndroidNotificationPriority.LOW,
        data: { type: RECORDING_NOTIFICATION_TYPE },
      },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch (e) {
  }
}

// 关闭"正在录音"通知
export async function hideRecordingNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
  } catch (e) {
  }
}
