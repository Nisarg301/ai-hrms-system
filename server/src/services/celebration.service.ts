import { IUser } from '../models/user.model';
import { addDays, eachDate } from '../utils/dates';
import { effectiveJoiningDate } from './people.service';

/** Today plus the next 7 days (spec default 16). */
export const CELEBRATION_DAYS_AHEAD = 7;

export type CelebrationKind = 'birthday' | 'anniversary';

export interface Celebration {
  user: IUser;
  kind: CelebrationKind;
  /** The date it falls on this time round (YYYY-MM-DD); says nothing about a birth year. */
  date: string;
  /** Anniversaries only: whole years since joining. */
  years: number | null;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Whether a yearly occasion first on `original` (YYYY-MM-DD) falls on `day`:
 * same month and day, with 29 February celebrated on 28 February in other years.
 */
export function fallsOn(original: string, day: string): boolean {
  const monthDay = original.slice(5);
  if (monthDay === day.slice(5)) return true;
  return monthDay === '02-29' && day.slice(5) === '02-28' && !isLeapYear(Number(day.slice(0, 4)));
}

/**
 * Birthdays and work anniversaries from `today` through the next 7 days, soonest
 * first then by name. An anniversary needs at least one full year; a birthday
 * only counts once it has happened (a date of birth isn't in the future).
 */
export function celebrationsBetween(members: IUser[], today: string, daysAhead = CELEBRATION_DAYS_AHEAD): Celebration[] {
  const days = eachDate(today, addDays(today, daysAhead));
  const found: Celebration[] = [];
  for (const user of members) {
    const joined = effectiveJoiningDate(user);
    for (const day of days) {
      if (user.dateOfBirth && user.dateOfBirth < day && fallsOn(user.dateOfBirth, day)) {
        found.push({ user, kind: 'birthday', date: day, years: null });
      }
      const years = Number(day.slice(0, 4)) - Number(joined.slice(0, 4));
      if (years >= 1 && fallsOn(joined, day)) {
        found.push({ user, kind: 'anniversary', date: day, years });
      }
    }
  }
  return found.sort((a, b) => a.date.localeCompare(b.date) || a.user.name.localeCompare(b.user.name) || a.kind.localeCompare(b.kind));
}
