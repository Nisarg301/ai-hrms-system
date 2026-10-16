import { theme } from 'antd';
import type { ThemeConfig } from 'antd';
import { getThemeTokens, type ThemeColor } from './tokens';

export const getAntdTheme = (isDark: boolean, color: ThemeColor = 'blue'): ThemeConfig => {
  const currentTokens = getThemeTokens(isDark, color);
  return {
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: currentTokens.colorPrimary,
      colorBgLayout: currentTokens.colorBgLayout,
      colorBorder: currentTokens.colorBorder,
      borderRadius: 8,
    },
    components: {
      Layout: {
        headerBg: isDark ? '#141414' : '#ffffff',
        bodyBg: currentTokens.colorBgLayout,
        siderBg: currentTokens.colorPrimaryDeep,
      },
      Menu: {
        darkItemBg: 'transparent',
        darkItemSelectedBg: 'rgba(255, 255, 255, 0.1)',
        darkItemColor: currentTokens.colorOnDarkMuted,
        darkItemSelectedColor: currentTokens.colorOnDark,
      },
    },
  };
};

export const antdTheme: ThemeConfig = getAntdTheme(false);
