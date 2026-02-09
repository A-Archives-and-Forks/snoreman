import { useState, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Switch,
  Linking,
  Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import i18n, { setLanguage, getCurrentLanguage } from '@/i18n';
import {
  getReminderSettings,
  saveReminderSettings,
  ReminderSettings,
  DEFAULT_REMINDER_TIME,
} from '@/utils/storage';

export default function SettingsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === 'dark';

  const [currentLanguage, setCurrentLanguage] = useState(getCurrentLanguage());
  const [isLanguageExpanded, setIsLanguageExpanded] = useState(false);

  // 提醒设置状态
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState(DEFAULT_REMINDER_TIME);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // 加载提醒设置
  useEffect(() => {
    loadReminderSettings();
  }, []);

  const loadReminderSettings = async () => {
    try {
      const settings = await getReminderSettings();
      setReminderEnabled(settings.enabled);
      setReminderTime({ hour: settings.hour, minute: settings.minute });
    } catch (error) {
      console.error('Failed to load reminder settings:', error);
    }
  };

  // 检查通知权限
  const checkNotificationPermission = async (): Promise<boolean> => {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  };

  // 请求通知权限
  const requestNotificationPermission = async (): Promise<boolean> => {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  };

  // 取消所有提醒通知
  const cancelAllReminders = async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
  };

  // 设置每日提醒
  const scheduleDailyReminder = async (hour: number, minute: number) => {
    // 取消现有通知
    await cancelAllReminders();

    // 设置新的每日通知
    await Notifications.scheduleNotificationAsync({
      content: {
        title: i18n.t('notification.title'),
        body: i18n.t('notification.body'),
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: hour,
        minute: minute,
      },
    });
  };

  // 处理提醒开关切换
  const handleReminderToggle = async (value: boolean) => {
    if (value) {
      // 开启提醒，检查权限
      const hasPermission = await checkNotificationPermission();
      if (!hasPermission) {
        const granted = await requestNotificationPermission();
        if (!granted) {
          // 权限被拒绝，显示提示
          Alert.alert(
            i18n.t('settings.notificationPermissionTitle'),
            i18n.t('settings.notificationPermissionMessage'),
            [
              { text: i18n.t('settings.cancel'), style: 'cancel' },
              {
                text: i18n.t('settings.openSettings'),
                onPress: () => Linking.openSettings(),
              },
            ]
          );
          return;
        }
      }

      // 设置每日提醒
      await scheduleDailyReminder(reminderTime.hour, reminderTime.minute);
    } else {
      // 关闭提醒，取消所有通知
      await cancelAllReminders();
    }

    // 保存设置
    const newSettings: ReminderSettings = {
      enabled: value,
      ...reminderTime,
    };
    await saveReminderSettings(newSettings);
    setReminderEnabled(value);
  };

  // 处理时间选择
  const handleTimeChange = async (event: any, selectedDate?: Date) => {
    setShowTimePicker(false);

    if (selectedDate && event.type !== 'dismissed') {
      const newHour = selectedDate.getHours();
      const newMinute = selectedDate.getMinutes();

      setReminderTime({ hour: newHour, minute: newMinute });

      // 保存设置
      const newSettings: ReminderSettings = {
        enabled: reminderEnabled,
        hour: newHour,
        minute: newMinute,
      };
      await saveReminderSettings(newSettings);

      // 如果提醒已启用，更新通知时间
      if (reminderEnabled) {
        await scheduleDailyReminder(newHour, newMinute);
      }
    }
  };

  // 格式化时间显示
  const formatTime = (hour: number, minute: number) => {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  };

  const toggleLanguageExpand = useCallback(() => {
    setIsLanguageExpanded(prev => !prev);
  }, []);

  const handleLanguageChange = useCallback(async (language: 'en' | 'zh') => {
    if (language === currentLanguage) return;
    
    await setLanguage(language);
    setCurrentLanguage(language);
    
    // 显示切换成功提示
    Alert.alert(
      i18n.t('settings.language'),
      language === 'zh' ? '语言已切换为中文' : 'Language switched to English',
      [{ text: 'OK', onPress: () => router.back() }]
    );
  }, [currentLanguage, router]);

  // 获取当前语言的显示文本
  const getCurrentLanguageText = () => {
    return currentLanguage === 'zh' 
      ? i18n.t('settings.chinese') 
      : i18n.t('settings.english');
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: i18n.t('settings.title'),
          headerBackTitle: i18n.t('recording.back'),
        }}
      />
      
      <View style={[styles.content, { paddingTop: insets.top + 16 }]}>
        {/* 语言设置项 - 可点击展开 */}
        <TouchableOpacity
          style={[
            styles.settingItem,
            { backgroundColor: isDark ? '#1E1E1E' : '#F8F9FA' },
          ]}
          onPress={toggleLanguageExpand}
          activeOpacity={0.7}
        >
          <View style={styles.settingLeft}>
            <Ionicons 
              name="language-outline" 
              size={24} 
              color={colors.tint} 
              style={styles.settingIcon}
            />
            <ThemedText style={styles.settingLabel}>
              {i18n.t('settings.language')}
            </ThemedText>
          </View>
          <View style={styles.settingRight}>
            <ThemedText style={styles.settingValue}>
              {getCurrentLanguageText()}
            </ThemedText>
            <Ionicons 
              name={isLanguageExpanded ? "chevron-up" : "chevron-down"} 
              size={20} 
              color={isDark ? '#888' : '#666'} 
            />
          </View>
        </TouchableOpacity>

        {/* 语言选项 - 展开时显示 */}
        {isLanguageExpanded && (
          <View style={styles.languageOptions}>
            <TouchableOpacity
              style={[
                styles.languageOption,
                {
                  backgroundColor: isDark ? '#2A2A2A' : '#FFFFFF',
                  borderColor: currentLanguage === 'en' ? colors.tint : isDark ? '#3A3A3A' : '#E0E0E0',
                  borderWidth: currentLanguage === 'en' ? 2 : 1,
                },
              ]}
              onPress={() => handleLanguageChange('en')}
              activeOpacity={0.7}
            >
              <ThemedText style={[
                styles.languageText,
                currentLanguage === 'en' && styles.languageTextActive,
              ]}>
                {i18n.t('settings.english')}
              </ThemedText>
              {currentLanguage === 'en' && (
                <Ionicons name="checkmark" size={20} color={colors.tint} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.languageOption,
                {
                  backgroundColor: isDark ? '#2A2A2A' : '#FFFFFF',
                  borderColor: currentLanguage === 'zh' ? colors.tint : isDark ? '#3A3A3A' : '#E0E0E0',
                  borderWidth: currentLanguage === 'zh' ? 2 : 1,
                },
              ]}
              onPress={() => handleLanguageChange('zh')}
              activeOpacity={0.7}
            >
              <ThemedText style={[
                styles.languageText,
                currentLanguage === 'zh' && styles.languageTextActive,
              ]}>
                {i18n.t('settings.chinese')}
              </ThemedText>
              {currentLanguage === 'zh' && (
                <Ionicons name="checkmark" size={20} color={colors.tint} />
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* 每日提醒设置 */}
        <View style={styles.reminderSection}>
          <TouchableOpacity
            style={[
              styles.settingItem,
              { backgroundColor: isDark ? '#1E1E1E' : '#F8F9FA' },
            ]}
            activeOpacity={1}
          >
            <View style={styles.settingLeft}>
              <Ionicons
                name="notifications-outline"
                size={24}
                color={colors.tint}
                style={styles.settingIcon}
              />
              <View>
                <ThemedText style={styles.settingLabel}>
                  {i18n.t('settings.reminder')}
                </ThemedText>
                <ThemedText style={styles.reminderDescription}>
                  {i18n.t('settings.reminderDescription')}
                </ThemedText>
              </View>
            </View>
            <Switch
              value={reminderEnabled}
              onValueChange={handleReminderToggle}
              trackColor={{ false: isDark ? '#3A3A3A' : '#D0D0D0', true: colors.tint }}
              thumbColor="#FFFFFF"
            />
          </TouchableOpacity>

          {/* 提醒时间设置 */}
          {reminderEnabled && (
            <TouchableOpacity
              style={[
                styles.timePickerItem,
                { backgroundColor: isDark ? '#2A2A2A' : '#FFFFFF' },
              ]}
              onPress={() => setShowTimePicker(true)}
              activeOpacity={0.7}
            >
              <View style={styles.timePickerContent}>
                <ThemedText style={styles.timePickerLabel}>
                  {i18n.t('settings.reminderTime')}
                </ThemedText>
                <ThemedText style={[styles.timePickerValue, { color: colors.tint }]}>
                  {formatTime(reminderTime.hour, reminderTime.minute)}
                </ThemedText>
              </View>
              <Ionicons
                name="time-outline"
                size={20}
                color={colors.tint}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* 时间选择器 */}
        {showTimePicker && (
          <DateTimePicker
            value={new Date(2024, 0, 1, reminderTime.hour, reminderTime.minute)}
            mode="time"
            is24Hour={true}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={handleTimeChange}
          />
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingIcon: {
    marginRight: 12,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  settingRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingValue: {
    fontSize: 14,
    opacity: 0.6,
  },
  languageOptions: {
    gap: 12,
    paddingHorizontal: 8,
  },
  languageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
  },
  languageText: {
    fontSize: 16,
  },
  languageTextActive: {
    fontWeight: '600',
    color: '#6C63FF',
  },
  reminderSection: {
    marginTop: 8,
  },
  reminderDescription: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 2,
  },
  timePickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    marginHorizontal: 8,
  },
  timePickerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  timePickerLabel: {
    fontSize: 14,
    opacity: 0.8,
  },
  timePickerValue: {
    fontSize: 16,
    fontWeight: '600',
  },
});
