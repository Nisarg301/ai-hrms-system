import type { PraiseBadge } from '../types/post';

/** Each praise badge's label, emoji and accent colour (the highlighted card and the picker). */
export const PRAISE_BADGES: Record<PraiseBadge, { label: string; emoji: string; color: string }> = {
  teamwork: { label: 'Teamwork', emoji: '🤝', color: '#1677ff' },
  above_and_beyond: { label: 'Above & beyond', emoji: '🚀', color: '#722ed1' },
  customer_first: { label: 'Customer first', emoji: '❤️', color: '#eb2f96' },
  innovation: { label: 'Innovation', emoji: '💡', color: '#fa8c16' },
  leadership: { label: 'Leadership', emoji: '🧭', color: '#13c2c2' },
  thank_you: { label: 'Thank you', emoji: '🙏', color: '#52c41a' },
};

export const PRAISE_BADGE_ORDER = Object.keys(PRAISE_BADGES) as PraiseBadge[];

/** "Ivy", "Ivy and Raj", "Ivy, Raj and Ann". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
