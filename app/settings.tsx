import { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import i18n, { setLanguage, getCurrentLanguage } from '@/i18n';

export default function SettingsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === 'dark';
  
  const [currentLanguage, setCurrentLanguage] = useState(getCurrentLanguage());
  const [isLanguageExpanded, setIsLanguageExpanded] = useState(false);

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
});
