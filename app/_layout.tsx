import { useEffect, useState } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import i18n, { initLanguage } from '@/i18n';

// 用应用色板定制导航主题：头部背景、文字、返回按钮 tint 都与设计系统统一
const NavLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Colors.light.brand,
    background: Colors.light.background,
    card: Colors.light.background,
    text: Colors.light.text,
    border: Colors.light.border,
  },
};

const NavDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Colors.dark.brand,
    background: Colors.dark.background,
    card: Colors.dark.background,
    text: Colors.dark.text,
    border: Colors.dark.border,
  },
};

// 配置通知处理器
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // "正在录音"通知：前台时不弹横幅/不出声（锁屏时仍正常显示），避免打扰
    const isRecording = notification.request.content.data?.type === 'recording';
    return {
      shouldShowAlert: !isRecording,
      shouldPlaySound: !isRecording,
      shouldSetBadge: false,
      shouldShowBanner: !isRecording,
      shouldShowList: true,
    };
  },
});

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    initLanguage().then(() => {
      setIsReady(true);
    });
  }, []);

  if (!isReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? NavDarkTheme : NavLightTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen 
            name="recording/[id]" 
            options={{ 
              headerBackTitle: i18n.t('recording.back'),
            }} 
          />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
