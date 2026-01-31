import { getLocales } from 'expo-localization';
import { I18n } from 'i18n-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en.json';
import zh from './locales/zh.json';

const i18n = new I18n({
  en,
  zh,
});

// 默认语言为英文
i18n.defaultLocale = 'en';
i18n.enableFallback = true;

// 存储键
const LANGUAGE_STORAGE_KEY = '@app_language';

// 检测系统语言是否为中文
function isChineseLocale(locale: string): boolean {
  return locale.startsWith('zh') || locale.startsWith('cmn') || locale.startsWith('yue');
}

// 初始化语言设置
export async function initLanguage(): Promise<void> {
  try {
    // 先尝试读取用户手动设置的语言
    const savedLanguage = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    
    if (savedLanguage) {
      // 用户有手动设置，使用用户设置
      i18n.locale = savedLanguage;
    } else {
      // 没有手动设置，检测系统语言
      const locales = getLocales();
      if (locales.length > 0) {
        const systemLocale = locales[0].languageCode || 'en';
        // 如果系统语言是中文，使用中文；否则默认英文
        i18n.locale = isChineseLocale(systemLocale) ? 'zh' : 'en';
      } else {
        i18n.locale = 'en';
      }
    }
  } catch (error) {
    // 出错时默认使用英文
    i18n.locale = 'en';
  }
}

// 手动切换语言
export async function setLanguage(language: 'en' | 'zh'): Promise<void> {
  i18n.locale = language;
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch (error) {
    // 存储失败静默处理
  }
}

// 获取当前语言
export function getCurrentLanguage(): 'en' | 'zh' {
  return i18n.locale as 'en' | 'zh';
}

// 获取系统语言（用于显示）
export function getSystemLanguage(): string {
  const locales = getLocales();
  return locales[0]?.languageCode || 'en';
}

export default i18n;
