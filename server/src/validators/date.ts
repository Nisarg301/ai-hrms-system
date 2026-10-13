import { z } from 'zod';
import { todayIso } from '../utils/dates';

/** A real calendar date written as YYYY-MM-DD (2026-02-30 is rejected). */
export const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format')
  .refine((value) => {
    const d = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }, 'Not a valid date');

/** A date of birth: a real date, not in the future, and not before 1900. */
export const dateOfBirthSchema = isoDateSchema
  .refine((value) => value <= todayIso(), "A date of birth can't be in the future")
  .refine((value) => value >= '1900-01-01', 'Enter a date after 1900');
