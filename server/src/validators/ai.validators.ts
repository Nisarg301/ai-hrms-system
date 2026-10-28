import { z } from 'zod';
import { AI_MODULE_KEYS } from '../ai/registry';
import { objectIdSchema } from './objectId';

export const chatSchema = z
  .object({
    module: z.enum(AI_MODULE_KEYS),
    conversationId: objectIdSchema.optional(),
    message: z.string().trim().min(1).max(2000).optional(),
    /** A starter chip or a button in an answer: runs the named tool with no model call. */
    toolCall: z
      .object({
        name: z.string().trim().min(1).max(64),
        args: z.record(z.unknown()).default({}),
        form: z.boolean().optional(),
        label: z.string().trim().max(120).optional(),
      })
      .optional(),
    /** The page the drawer is on ("/expenses?tab=summary"), for "You're already on" and navigation. */
    page: z.string().trim().max(300).regex(/^\/(?!\/)/, 'Must be a path in the app').optional(),
  })
  .strict()
  .refine((v) => Boolean(v.message) !== Boolean(v.toolCall), { message: 'Send either a message or a toolCall' });

/** Confirm, optionally with the values the user edited on the card. */
export const confirmSchema = z.object({ values: z.record(z.unknown()).optional() }).strict();

export const conversationsQuerySchema = z.object({ module: z.enum(AI_MODULE_KEYS).optional() });
