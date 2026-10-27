import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ConfigProvider } from 'antd';
import { getAntdTheme } from './antdTheme';
import { getThemeTokens, type ThemeColor, type ThemeTokens } from './tokens';

export type ThemeMode = 'light' | 'dark' | 'system';
export type { ThemeColor };

export interface ThemeContextValue {
  themeMode: ThemeMode;
  themeColor: ThemeColor;
  isDarkMode: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setThemeColor: (color: ThemeColor) => void;
  toggleDarkMode: () => void;
  tokens: ThemeTokens;
}

const THEME_MODE_STORAGE_KEY = 'theme_mode';
const THEME_COLOR_STORAGE_KEY = 'theme_color';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemPreference(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'system';
    try {
      const saved = localStorage.getItem(THEME_MODE_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        return saved;
      }
    } catch {
      // Ignore
    }
    return 'system';
  });

  const [themeColor, setThemeColorState] = useState<ThemeColor>(() => {
    if (typeof window === 'undefined') return 'blue';
    try {
      const saved = localStorage.getItem(THEME_COLOR_STORAGE_KEY);
      if (saved === 'purple' || saved === 'blue' || saved === 'pink' || saved === 'green' || saved === 'orange') {
        return saved;
      }
    } catch {
      // Ignore
    }
    return 'blue';
  });

  const [systemIsDark, setSystemIsDark] = useState<boolean>(getSystemPreference);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemIsDark(e.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore
    }
  };

  const setThemeColor = (color: ThemeColor) => {
    setThemeColorState(color);
    try {
      localStorage.setItem(THEME_COLOR_STORAGE_KEY, color);
    } catch {
      // Ignore
    }
  };

  const isDarkMode = useMemo(() => {
    if (themeMode === 'dark') return true;
    if (themeMode === 'light') return false;
    return systemIsDark;
  }, [themeMode, systemIsDark]);

  const toggleDarkMode = () => {
    setThemeMode(isDarkMode ? 'light' : 'dark');
  };

  const currentTokens = useMemo(() => getThemeTokens(isDarkMode, themeColor), [isDarkMode, themeColor]);
  const antdThemeConfig = useMemo(() => getAntdTheme(isDarkMode, themeColor), [isDarkMode, themeColor]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    if (isDarkMode) {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }

    root.style.setProperty('--theme-primary', currentTokens.colorPrimary);
    root.style.setProperty('--theme-deep', currentTokens.colorPrimaryDeep);
    root.style.setProperty('--theme-accent', currentTokens.colorAccent);
    root.style.setProperty('--theme-bg', currentTokens.colorBgLayout);
    root.style.setProperty('--theme-border', currentTokens.colorBorder);
  }, [isDarkMode, currentTokens]);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      themeMode,
      themeColor,
      isDarkMode,
      setThemeMode,
      setThemeColor,
      toggleDarkMode,
      tokens: currentTokens,
    }),
    [themeMode, themeColor, isDarkMode, currentTokens]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <ConfigProvider theme={antdThemeConfig}>{children}</ConfigProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

/**
 * The current theme's tokens, or the default light theme's outside a ThemeProvider (a
 * component rendered on its own, as in most tests). For small shared pieces such as avatars.
 */
export function useThemeTokens(): Pick<ThemeContextValue, 'tokens' | 'isDarkMode'> {
  const context = useContext(ThemeContext);
  return context ?? { tokens: getThemeTokens(false), isDarkMode: false };
}
