/**
 * 设计系统 Design Tokens
 * 清爽极简风格：白卡 + 发丝边框 + 克制阴影 + 充足留白。
 * 所有颜色、间距、圆角、字号、阴影都从这里取，避免各组件各写一套。
 */

// 品牌色（应用身份色）
const BRAND = '#6C63FF';
const BRAND_DARK = '#8B84FF'; // 深色模式下略提亮，保证对比度

// 警示红：深色模式降低饱和度与亮度，避免深色背景上大面积红色刺眼
const DANGER = '#FF453A';
const DANGER_DARK = '#E0655C';

// 与场景无关的固定色板
export const Palette = {
  brand: BRAND,
  success: '#34C759',
};

export const Colors = {
  light: {
    text: '#16161D',        // 主文字
    textMuted: '#6E6E7A',   // 次要文字
    textFaint: '#A6A6B2',   // 最弱文字/占位
    background: '#FFFFFF',   // 页面背景
    surface: '#FFFFFF',      // 卡片背景
    surfaceSunken: '#F4F4F7',// 内嵌区域（图表底、输入等）
    border: '#ECECF1',       // 发丝边框
    brand: BRAND,
    brandSoft: '#EEEDFF',    // 品牌浅底（图标底等）
    tint: BRAND,
    icon: '#6E6E7A',
    tabIconDefault: '#6E6E7A',
    tabIconSelected: BRAND,
    danger: DANGER,
    // 打鼾严重程度
    severity: {
      none: '#34C759',
      mild: '#8BC34A',
      moderate: '#FF9F0A',
      severe: DANGER,
      unknown: '#9E9E9E',
    },
  },
  dark: {
    text: '#F2F2F7',
    textMuted: '#9C9CA8',
    textFaint: '#6A6A78',
    background: '#0E0E12',
    surface: '#1A1A22',
    surfaceSunken: '#101016',
    border: '#2A2A34',
    brand: BRAND_DARK,
    brandSoft: 'rgba(108,99,255,0.18)',
    tint: BRAND_DARK,
    icon: '#9C9CA8',
    tabIconDefault: '#9C9CA8',
    tabIconSelected: BRAND_DARK,
    danger: DANGER_DARK,
    severity: {
      none: '#34C759',
      mild: '#8BC34A',
      moderate: '#FF9F0A',
      severe: DANGER_DARK,
      unknown: '#9E9E9E',
    },
  },
};

export type ThemeColors = typeof Colors.light;

// 间距刻度（4 的倍数）
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

// 圆角刻度
export const Radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
};

// 字号刻度
export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 28,
  display: 34,
};

// 卡片阴影（清爽风格用极淡阴影，深色模式关闭阴影靠边框区分）
export const Shadow = {
  light: {
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  dark: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
};
