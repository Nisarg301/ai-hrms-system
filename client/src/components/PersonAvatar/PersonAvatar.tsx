import { Avatar } from 'antd';
import { useThemeTokens } from '../../theme/ThemeContext';
import type { ThemeTokens } from '../../theme/tokens';

/**
 * The colours of a letter avatar, the same on every page and in the header: a white letter on
 * the theme's deep colour in light mode, a dark letter on its bright colour in dark mode. Both
 * read at 7:1 or better in every theme colour (WCAG AAA); a white letter on the bright dark-mode
 * colour read at about 2:1.
 */
export function avatarColors(tokens: ThemeTokens, isDarkMode: boolean): { background: string; color: string } {
  return isDarkMode ? { background: tokens.colorPrimary, color: tokens.colorPrimaryDeep } : { background: tokens.colorPrimaryDeep, color: tokens.colorOnDark };
}

/**
 * The letter shown for someone without a photo: their name's first, as in the header's
 * account menu ("Aakash" → "A", "Ivy Mehta" → "I"). Taken by character, so a name that starts
 * with an emoji or a non-Latin letter isn't cut in half.
 */
export function initialOf(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toUpperCase() : '?';
}

interface PersonAvatarProps {
  name: string;
  avatarUrl: string | null | undefined;
  size?: number | 'small' | 'default' | 'large';
}

/** A colleague's photo, or their initial in the theme's avatar colours. */
export function PersonAvatar({ name, avatarUrl, size = 'default' }: PersonAvatarProps) {
  const { tokens, isDarkMode } = useThemeTokens();
  if (avatarUrl) {
    return <Avatar size={size} src={avatarUrl} alt={name} />;
  }
  return (
    <Avatar size={size} style={{ ...avatarColors(tokens, isDarkMode), flexShrink: 0 }} aria-label={name}>
      {initialOf(name)}
    </Avatar>
  );
}
