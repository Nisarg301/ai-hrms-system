import { z } from 'zod';

export const holidaySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Keep it under 100 characters'),
  date: z.string().min(1, 'Pick a date'),
  description: z.string().trim().max(500, 'Keep it under 500 characters'),
});

export type HolidayFormValues = z.infer<typeof holidaySchema>;
