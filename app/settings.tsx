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
import { useTheme } from '@/hooks/use-theme';
import { useThemePreference, ThemeMode } from '@/hooks/theme-preference';
import { Spacing, Radius, FontSize } from '@/constants/theme';
import i18n, { setLanguage, getCurrentLanguage, SUPPORTED_LANGUAGES, LanguageCode } from '@/i18n';
import {
  getReminderSettings,
  saveReminderSettings,
  ReminderSettings,
  DEFAULT_REMINDER_TIME,
} from '@/utils/storage';

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, isDark, shadow } = useTheme();
  const { mode: themeMode, setMode: setThemeMode } = useThemePreference();
  const insets = useSafeAreaInsets();

  const [currentLanguage, setCurrentLanguage] = useState(getCurrentLanguage());
  const [isLanguageExpanded, setIsLanguageExpanded] = useState(false);

  // 外观选项（跟随系统 / 浅色 / 深色）
  const THEME_OPTIONS: { mode: ThemeMode; icon: 'phone-portrait-outline' | 'sunny-outline' | 'moon-outline' }[] = [
    { mode: 'system', icon: 'phone-portrait-outline' },
    { mode: 'light', icon: 'sunny-outline' },
    { mode: 'dark', icon: 'moon-outline' },
  ];

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

  const handleLanguageChange = useCallback(async (language: LanguageCode) => {
    if (language === currentLanguage) return;

    await setLanguage(language);
    setCurrentLanguage(language);

    // 切换后 i18n 已是新语言，提示以新语言展示
    Alert.alert(
      i18n.t('settings.language'),
      i18n.t('settings.languageChanged'),
      [{ text: 'OK', onPress: () => router.back() }]
    );
  }, [currentLanguage, router]);

  // 获取当前语言的原生名称
  const getCurrentLanguageText = () => {
    return SUPPORTED_LANGUAGES.find((l) => l.code === currentLanguage)?.nativeName ?? 'English';
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
            { backgroundColor: colors.surface, borderColor: colors.border },
            shadow,
          ]}
          onPress={toggleLanguageExpand}
          activeOpacity={0.7}
        >
          <View style={styles.settingLeft}>
            <View style={[styles.settingIconWrap, { backgroundColor: colors.brandSoft }]}>
              <Ionicons
                name="language-outline"
                size={20}
                color={colors.brand}
              />
            </View>
            <ThemedText style={styles.settingLabel}>
              {i18n.t('settings.language')}
            </ThemedText>
          </View>
          <View style={styles.settingRight}>
            <ThemedText style={[styles.settingValue, { color: colors.textMuted }]}>
              {getCurrentLanguageText()}
            </ThemedText>
            <Ionicons
              name={isLanguageExpanded ? "chevron-up" : "chevron-down"}
              size={18}
              color={colors.textFaint}
            />
          </View>
        </TouchableOpacity>

        {/* 语言选项 - 展开时显示 */}
        {isLanguageExpanded && (
          <View style={styles.languageOptions}>
            {SUPPORTED_LANGUAGES.map(({ code, nativeName }) => {
              const active = currentLanguage === code;
              return (
                <TouchableOpacity
                  key={code}
                  style={[
                    styles.languageOption,
                    {
                      backgroundColor: active ? colors.brandSoft : colors.surface,
                      borderColor: active ? colors.brand : colors.border,
                    },
                  ]}
                  onPress={() => handleLanguageChange(code)}
                  activeOpacity={0.7}
                >
                  <ThemedText style={[
                    styles.languageText,
                    active && { fontWeight: '600', color: colors.brand },
                  ]}>
                    {nativeName}
                  </ThemedText>
                  {active && (
                    <Ionicons name="checkmark-circle" size={20} color={colors.brand} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* 外观设置 */}
        <View style={[styles.settingItem, { backgroundColor: colors.surface, borderColor: colors.border }, shadow]}>
          <View style={styles.settingLeft}>
            <View style={[styles.settingIconWrap, { backgroundColor: colors.brandSoft }]}>
              <Ionicons name="contrast-outline" size={20} color={colors.brand} />
            </View>
            <ThemedText style={styles.settingLabel}>
              {i18n.t('settings.appearance')}
            </ThemedText>
          </View>
        </View>
        <View style={styles.themeOptions}>
          {THEME_OPTIONS.map(({ mode, icon }) => {
            const active = themeMode === mode;
            return (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.themeOption,
                  {
                    backgroundColor: active ? colors.brandSoft : colors.surface,
                    borderColor: active ? colors.brand : colors.border,
                  },
                ]}
                onPress={() => setThemeMode(mode)}
                activeOpacity={0.7}
              >
                <Ionicons name={icon} size={20} color={active ? colors.brand : colors.textMuted} />
                <ThemedText
                  style={[
                    styles.themeOptionText,
                    { color: active ? colors.brand : colors.textMuted },
                    active && { fontWeight: '600' },
                  ]}
                >
                  {i18n.t(`settings.theme_${mode}`)}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 每日提醒设置 */}
        <View style={styles.reminderSection}>
          <View
            style={[
              styles.settingItem,
              { backgroundColor: colors.surface, borderColor: colors.border },
              shadow,
            ]}
          >
            <View style={styles.settingLeft}>
              <View style={[styles.settingIconWrap, { backgroundColor: colors.brandSoft }]}>
                <Ionicons
                  name="notifications-outline"
                  size={20}
                  color={colors.brand}
                />
              </View>
              <View style={styles.reminderTextWrap}>
                <ThemedText style={styles.settingLabel}>
                  {i18n.t('settings.reminder')}
                </ThemedText>
                <ThemedText style={[styles.reminderDescription, { color: colors.textFaint }]}>
                  {i18n.t('settings.reminderDescription')}
                </ThemedText>
              </View>
            </View>
            <Switch
              value={reminderEnabled}
              onValueChange={handleReminderToggle}
              trackColor={{ false: isDark ? '#3A3A3A' : '#E0E0E5', true: colors.brand }}
              thumbColor="#FFFFFF"
            />
          </View>

          {/* 提醒时间设置 */}
          {reminderEnabled && (
            <TouchableOpacity
              style={[
                styles.timePickerItem,
                { backgroundColor: colors.surfaceSunken },
              ]}
              onPress={() => setShowTimePicker(true)}
              activeOpacity={0.7}
            >
              <View style={styles.timePickerContent}>
                <ThemedText style={[styles.timePickerLabel, { color: colors.textMuted }]}>
                  {i18n.t('settings.reminderTime')}
                </ThemedText>
                <ThemedText style={[styles.timePickerValue, { color: colors.brand }]}>
                  {formatTime(reminderTime.hour, reminderTime.minute)}
                </ThemedText>
              </View>
              <Ionicons
                name="time-outline"
                size={20}
                color={colors.brand}
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
    padding: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  settingLabel: {
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  settingRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  settingValue: {
    fontSize: FontSize.sm,
  },
  languageOptions: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    marginBottom: Spacing.md,
  },
  languageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  languageText: {
    fontSize: FontSize.md,
  },
  themeOptions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    marginBottom: Spacing.md,
  },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  themeOptionText: {
    fontSize: FontSize.sm,
  },
  reminderSection: {
    marginTop: Spacing.xs,
  },
  reminderTextWrap: {
    flex: 1,
  },
  reminderDescription: {
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  timePickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
    borderRadius: Radius.md,
    marginHorizontal: Spacing.xs,
  },
  timePickerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  timePickerLabel: {
    fontSize: FontSize.sm,
  },
  timePickerValue: {
    fontSize: FontSize.md,
    fontWeight: '600',
  },
});
