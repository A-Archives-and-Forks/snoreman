import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 用户的主题偏好：跟随系统 / 强制浅色 / 强制深色
export type ThemeMode = 'system' | 'light' | 'dark';
type Scheme = 'light' | 'dark';

const STORAGE_KEY = 'theme_mode';

interface ThemePreferenceValue {
  mode: ThemeMode;   // 用户设置的偏好
  scheme: Scheme;    // 实际生效的配色（偏好为 system 时取系统值）
  setMode: (m: ThemeMode) => void;
}

const ThemePreferenceContext = createContext<ThemePreferenceValue>({
  mode: 'system',
  scheme: 'light',
  setMode: () => {},
});

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const system = useRNColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  // 启动时读取已保存的偏好
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setModeState(v);
      })
      .catch(() => {});
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  }, []);

  const scheme: Scheme = mode === 'system' ? (system ?? 'light') : mode;

  return (
    <ThemePreferenceContext.Provider value={{ mode, scheme, setMode }}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

// 设置页用：读取/修改偏好
export function useThemePreference() {
  return useContext(ThemePreferenceContext);
}

// 内部用：当前生效的配色方案
export function useResolvedScheme(): Scheme {
  return useContext(ThemePreferenceContext).scheme;
}
