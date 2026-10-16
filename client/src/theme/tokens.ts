/**
 * Single source of truth for the theme palette.
 * Supports light & dark modes and multi-color themes (Purple, Blue, Pink, Green, Orange).
 */

export type ThemeColor = 'purple' | 'blue' | 'pink' | 'green' | 'orange';

export interface ThemeTokens {
  colorPrimary: string;
  colorPrimaryDeep: string;
  colorAccent: string;
  colorBgLayout: string;
  colorBorder: string;
  colorStatusActiveBg: string;
  colorStatusActiveText: string;
  colorStatusNeutralBg: string;
  colorStatusNeutralText: string;
  colorOnDark: string;
  colorOnDarkMuted: string;
  colorOnDarkFooter: string;
}

export const THEME_COLOR_CONFIG: Record<
  ThemeColor,
  { name: string; swatch: string }
> = {
  purple: { name: 'Purple', swatch: '#7c3aed' },
  blue: { name: 'Blue', swatch: '#1677ff' },
  pink: { name: 'Pink', swatch: '#ec4899' },
  green: { name: 'Green', swatch: '#10b981' },
  orange: { name: 'Orange', swatch: '#f59e0b' },
};

const commonTokens = {
  colorOnDark: '#ffffff',
  colorOnDarkMuted: '#bcdce3',
  colorOnDarkFooter: '#7fa9b3',
};

const palettes: Record<ThemeColor, { light: ThemeTokens; dark: ThemeTokens }> = {
  blue: {
    light: {
      ...commonTokens,
      colorPrimary: '#0e5266',
      colorPrimaryDeep: '#0b3a4a',
      colorAccent: '#2dd4bf',
      colorBgLayout: '#f4f7f8',
      colorBorder: '#dfe6e8',
      colorStatusActiveBg: '#e6f7f1',
      colorStatusActiveText: '#0d7a56',
      colorStatusNeutralBg: '#f3f4f6',
      colorStatusNeutralText: '#4b5563',
    },
    dark: {
      ...commonTokens,
      colorPrimary: '#38bdf8',
      colorPrimaryDeep: '#07181e',
      colorAccent: '#2dd4bf',
      colorBgLayout: '#0d1315',
      colorBorder: '#1e2b30',
      colorStatusActiveBg: '#0f3930',
      colorStatusActiveText: '#34d399',
      colorStatusNeutralBg: '#1e293b',
      colorStatusNeutralText: '#94a3b8',
    },
  },
  purple: {
    light: {
      ...commonTokens,
      colorPrimary: '#7048e8',
      colorPrimaryDeep: '#2e1065',
      colorAccent: '#8b5cf6',
      colorBgLayout: '#f7f5fa',
      colorBorder: '#e5def0',
      colorStatusActiveBg: '#ede9fe',
      colorStatusActiveText: '#6d28d9',
      colorStatusNeutralBg: '#f3f4f6',
      colorStatusNeutralText: '#4b5563',
    },
    dark: {
      ...commonTokens,
      colorPrimary: '#a78bfa',
      colorPrimaryDeep: '#130722',
      colorAccent: '#a78bfa',
      colorBgLayout: '#0f0c14',
      colorBorder: '#2b1f3d',
      colorStatusActiveBg: '#2e1065',
      colorStatusActiveText: '#c4b5fd',
      colorStatusNeutralBg: '#1e293b',
      colorStatusNeutralText: '#94a3b8',
    },
  },
  pink: {
    light: {
      ...commonTokens,
      colorPrimary: '#d6336c',
      colorPrimaryDeep: '#500724',
      colorAccent: '#ec4899',
      colorBgLayout: '#fdf5f8',
      colorBorder: '#f5d5e2',
      colorStatusActiveBg: '#fce7f3',
      colorStatusActiveText: '#db2777',
      colorStatusNeutralBg: '#f3f4f6',
      colorStatusNeutralText: '#4b5563',
    },
    dark: {
      ...commonTokens,
      colorPrimary: '#f472b6',
      colorPrimaryDeep: '#1e050f',
      colorAccent: '#f472b6',
      colorBgLayout: '#14090e',
      colorBorder: '#3b1a27',
      colorStatusActiveBg: '#500724',
      colorStatusActiveText: '#fbcfe8',
      colorStatusNeutralBg: '#1e293b',
      colorStatusNeutralText: '#94a3b8',
    },
  },
  green: {
    light: {
      ...commonTokens,
      colorPrimary: '#0ca678',
      colorPrimaryDeep: '#064e3b',
      colorAccent: '#10b981',
      colorBgLayout: '#f2f9f5',
      colorBorder: '#d1ede0',
      colorStatusActiveBg: '#d1fae5',
      colorStatusActiveText: '#065f46',
      colorStatusNeutralBg: '#f3f4f6',
      colorStatusNeutralText: '#4b5563',
    },
    dark: {
      ...commonTokens,
      colorPrimary: '#34d399',
      colorPrimaryDeep: '#021a14',
      colorAccent: '#10b981',
      colorBgLayout: '#081410',
      colorBorder: '#19382b',
      colorStatusActiveBg: '#064e3b',
      colorStatusActiveText: '#6ee7b7',
      colorStatusNeutralBg: '#1e293b',
      colorStatusNeutralText: '#94a3b8',
    },
  },
  orange: {
    light: {
      ...commonTokens,
      colorPrimary: '#ea580c',
      colorPrimaryDeep: '#7c2d12',
      colorAccent: '#f97316',
      colorBgLayout: '#fdf8f4',
      colorBorder: '#fbdcc4',
      colorStatusActiveBg: '#fef3c7',
      colorStatusActiveText: '#92400e',
      colorStatusNeutralBg: '#f3f4f6',
      colorStatusNeutralText: '#4b5563',
    },
    dark: {
      ...commonTokens,
      colorPrimary: '#fb923c',
      colorPrimaryDeep: '#200b04',
      colorAccent: '#f97316',
      colorBgLayout: '#160e08',
      colorBorder: '#3d2314',
      colorStatusActiveBg: '#78350f',
      colorStatusActiveText: '#fde68a',
      colorStatusNeutralBg: '#1e293b',
      colorStatusNeutralText: '#94a3b8',
    },
  },
};

/** Default backwards-compatible tokens export */
export const tokens: ThemeTokens = palettes.blue.light;
export const darkTokens: ThemeTokens = palettes.blue.dark;

export type Tokens = ThemeTokens;

export const getThemeTokens = (isDark: boolean, color: ThemeColor = 'blue'): ThemeTokens => {
  const palette = palettes[color] ?? palettes.blue;
  return isDark ? palette.dark : palette.light;
};
