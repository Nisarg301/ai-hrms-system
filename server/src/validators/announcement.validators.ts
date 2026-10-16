import { z } from 'zod';
import { isoDateSchema } from './date';

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(5000),
  pinned: z.boolean().default(false),
  expiresOn: isoDateSchema.nullable().default(null),
});

export const updateAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(150).optional(),
  body: z.string().trim().min(1).max(5000).optional(),
  pinned: z.boolean().optional(),
  // null removes the expiry.
  expiresOn: isoDateSchema.nullable().optional(),
});
