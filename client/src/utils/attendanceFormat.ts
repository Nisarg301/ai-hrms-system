import dayjs from 'dayjs';
import type { DayStatus, DayView } from '../types/attendance';

/** Label, antd tag colour and a one-letter code (for the dense month grid) per status. */
export const STATUS_META: Record<DayStatus, { label: string; color: string; short: string }> = {
  present: { label: 'Present', color: 'green', short: 'P' },
  half_day: { label: 'Half day', color: 'gold', short: 'H' },
  absent: { label: 'Absent', color: 'red', short: 'A' },
  on_leave: { label: 'On leave', color: 'purple', short: 'L' },
  holiday: { label: 'Holiday', color: 'cyan', short: '★' },
  weekend: { label: 'Weekend', color: 'default', short: '–' },
  worked_on_off_day: { label: 'Worked on day off', color: 'blue', short: 'W' },
  in_progress: { label: 'In progress', color: 'processing', short: '●' },
  not_in_yet: { label: 'Not in yet', color: 'default', short: '·' },
  missing_clock_out: { label: 'Missing clock-out', color: 'orange', short: '!' },
  upcoming: { label: 'Upcoming', color: 'default', short: '' },
  not_joined: { label: 'Not joined yet', color: 'default', short: '' },
};

/** 495 → "8h 15m"; 45 → "45m"; 0 → "0m". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** An ISO instant as local "09:42", or "—". */
export function formatTime(iso: string | null | undefined): string {
  return iso ? dayjs(iso).format('HH:mm') : '—';
}

/** Days you can ask to fix: today and up to 30 days back, not days off or full leave. */
export function canRequestFix(day: DayView, today: string): boolean {
  if (day.date > today || day.date < dayjs(today).subtract(30, 'day').format('YYYY-MM-DD')) return false;
  if (day.status === 'on_leave' || day.status === 'upcoming' || day.status === 'not_joined') return false;
  return true;
}
