import { z } from 'zod';
import { isoDateSchema } from './date';

export const createHolidaySchema = z.object({
  name: z.string().trim().min(1).max(100),
  date: isoDateSchema,
  description: z.string().trim().max(500).default(''),
});

export const updateHolidaySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  date: isoDateSchema.optional(),
  description: z.string().trim().max(500).optional(),
});

export const listHolidaysQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
