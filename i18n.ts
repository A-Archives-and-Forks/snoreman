import { getLocales } from 'expo-localization';
import { I18n } from 'i18n-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en.json';
import zh from './locales/zh.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';

// 支持的语言：code + 原生名称（用于设置页展示与选择）+ 日期格式化 locale
export const SUPPORTED_LANGUAGES = [
  { code: 'en', nativeName: 'English', dateLocale: 'en-US' },
  { code: 'zh', nativeName: '中文', dateLocale: 'zh-CN' },
  { code: 'ja', nativeName: '日本語', dateLocale: 'ja-JP' },
  { code: 'ko', nativeName: '한국어', dateLocale: 'ko-KR' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map((l) => l.code) as string[];

const i18n = new I18n({ en, zh, ja, ko });

// 默认语言为英文
i18n.defaultLocale = 'en';
i18n.enableFallback = true;

// 存储键
const LANGUAGE_STORAGE_KEY = '@app_language';

// 把系统 locale（如 'zh-Hans'、'ja'、'ko-KR'、'yue'）映射到支持的语言
function matchSupportedLanguage(systemLocale: string): LanguageCode {
  const lower = systemLocale.toLowerCase();
  if (lower.startsWith('zh') || lower.startsWith('cmn') || lower.startsWith('yue')) return 'zh';
  if (lower.startsWith('ja')) return 'ja';
  if (lower.startsWith('ko')) return 'ko';
  return 'en';
}

// 初始化语言设置
export async function initLanguage(): Promise<void> {
  try {
    // 先尝试读取用户手动设置的语言
    const savedLanguage = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (savedLanguage && SUPPORTED_CODES.includes(savedLanguage)) {
      i18n.locale = savedLanguage;
      return;
    }
    // 没有手动设置，检测系统语言
    const locales = getLocales();
    const systemLocale = locales[0]?.languageCode || 'en';
    i18n.locale = matchSupportedLanguage(systemLocale);
  } catch (error) {
    // 出错时默认使用英文
    i18n.locale = 'en';
  }
}

// 手动切换语言
export async function setLanguage(language: LanguageCode): Promise<void> {
  i18n.locale = language;
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch (error) {
    // 存储失败静默处理
  }
}

// 获取当前语言
export function getCurrentLanguage(): LanguageCode {
  const code = i18n.locale as string;
  return (SUPPORTED_CODES.includes(code) ? code : 'en') as LanguageCode;
}

// 当前语言对应的日期格式化 locale（BCP-47）
export function getDateLocale(): string {
  const lang = SUPPORTED_LANGUAGES.find((l) => l.code === getCurrentLanguage());
  return lang?.dateLocale ?? 'en-US';
}

export default i18n;
