import { Avatar } from 'antd';

// Soft, readable backgrounds for initials; a name always gets the same one.
const COLORS = ['#7048e8', '#0ca678', '#d6336c', '#1677ff', '#ea580c', '#0e7490', '#9c36b5', '#2f9e44'];

function colorFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

interface PersonAvatarProps {
  name: string;
  avatarUrl: string | null | undefined;
  size?: number | 'small' | 'default' | 'large';
}

/** A colleague's photo, or their initials on a colour picked from their name. */
export function PersonAvatar({ name, avatarUrl, size = 'default' }: PersonAvatarProps) {
  if (avatarUrl) {
    return <Avatar size={size} src={avatarUrl} alt={name} />;
  }
  return (
    <Avatar size={size} style={{ background: colorFor(name), flexShrink: 0 }} aria-label={name}>
      {initials(name)}
    </Avatar>
  );
}
