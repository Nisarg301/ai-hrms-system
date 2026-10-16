import dayjs from 'dayjs';
import type { HalfDay } from '../types/leave';

/** 1, 0.5, 2.5 */
export function formatDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "05 Oct 2026", "05 – 07 Oct 2026", "30 Sep – 02 Oct 2026", plus "(first half)". */
export function formatLeaveDates(startDate: string, endDate: string, halfDay: HalfDay | null = null): string {
  const start = dayjs(startDate);
  const end = dayjs(endDate);
  let range: string;
  if (startDate === endDate) range = start.format('DD MMM YYYY');
  else if (start.month() === end.month()) range = `${start.format('DD')} – ${end.format('DD MMM YYYY')}`;
  else range = `${start.format('DD MMM')} – ${end.format('DD MMM YYYY')}`;
  return halfDay ? `${range} (${halfDay} half)` : range;
}
