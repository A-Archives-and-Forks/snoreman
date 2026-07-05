import { Colors, Shadow, ThemeColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface Theme {
  colors: ThemeColors;
  shadow: typeof Shadow.light;
  isDark: boolean;
  scheme: 'light' | 'dark';
}

// 统一取当前配色方案下的语义色板与阴影，替代各处散落的 isDark ? A : B
export function useTheme(): Theme {
  const scheme = useColorScheme() ?? 'light';
  return {
    colors: Colors[scheme],
    shadow: Shadow[scheme],
    isDark: scheme === 'dark',
    scheme,
  };
}
