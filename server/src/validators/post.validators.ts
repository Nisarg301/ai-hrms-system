import { z } from 'zod';
import { MAX_PRAISE_RECIPIENTS, PRAISE_BADGES } from '../models/post.model';
import { objectIdSchema } from './objectId';

export const createPostSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(2000),
  /** Makes the post a praise: 1–5 colleagues and a badge. */
  praise: z
    .object({
      recipientIds: z
        .array(objectIdSchema)
        .min(1, 'Choose who to praise')
        .max(MAX_PRAISE_RECIPIENTS, `Praise up to ${MAX_PRAISE_RECIPIENTS} people at a time`),
      badge: z.enum(PRAISE_BADGES),
    })
    .strict()
    .optional(),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(1000),
});

export const feedQuerySchema = z.object({
  cursor: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
