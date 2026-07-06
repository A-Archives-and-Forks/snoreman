import { Alert, TouchableOpacity } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { MaterialIcons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/use-theme';
import i18n from '@/i18n';

// 录音详情页导航栏的横竖屏切换按钮。
// 放在 _layout 的路由 options 里静态声明——如果由页面挂载后再注入 headerRight，
// iOS 26 玻璃质感头部会重建按钮并带一次高光动画（深色模式下闪一下）
export function OrientationToggleButton() {
  const { colors } = useTheme();

  const toggleOrientation = async () => {
    try {
      const orientation = await ScreenOrientation.getOrientationAsync();
      const isCurrentlyLandscape =
        orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
        orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;

      if (isCurrentlyLandscape) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      }
    } catch {
      Alert.alert(i18n.t('recording.toggleOrientation'), i18n.t('recording.orientationFailed'));
    }
  };

  return (
    <TouchableOpacity
      onPress={toggleOrientation}
      style={{ padding: 8 }}
      activeOpacity={0.7}
      accessibilityLabel={i18n.t('recording.toggleOrientation')}
      accessibilityRole="button"
    >
      <MaterialIcons name="screen-rotation" size={22} color={colors.text} />
    </TouchableOpacity>
  );
}
