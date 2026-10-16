import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

/** "3 minutes ago", "2 days ago". */
export function fromNow(iso: string): string {
  return dayjs(iso).fromNow();
}

/** "Mon, 5 Oct" for a YYYY-MM-DD date. */
export function shortDate(isoDate: string): string {
  return dayjs(isoDate).format('ddd, D MMM');
}

/** "Good morning" / "Good afternoon" / "Good evening" for the local hour. */
export function greeting(hour: number = new Date().getHours()): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Whole days from `fromDate` to `toDate` (both YYYY-MM-DD). */
export function daysBetween(fromDate: string, toDate: string): number {
  return dayjs(toDate).diff(dayjs(fromDate), 'day');
}
