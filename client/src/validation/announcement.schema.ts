import { z } from 'zod';

export const announcementSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(150, 'Keep the title under 150 characters'),
  body: z.string().trim().min(1, 'Write the announcement').max(5000, 'Keep it under 5,000 characters'),
  pinned: z.boolean(),
  /** YYYY-MM-DD or null for no expiry. */
  expiresOn: z.string().nullable(),
});

export type AnnouncementFormValues = z.infer<typeof announcementSchema>;
