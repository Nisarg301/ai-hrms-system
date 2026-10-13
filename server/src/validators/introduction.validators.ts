import { z } from 'zod';
import { dateOfBirthSchema } from './date';

const answer = z.string().trim().max(1000);

// All optional: send only what changed; an empty string clears an answer.
export const updateIntroductionSchema = z
  .object({
    about: answer.optional(),
    hobbies: answer.optional(),
    lovesAboutJob: answer.optional(),
  })
  .strict();

/** PUT /me/profile-details: my own date of birth; null clears it. */
export const updateMyDetailsSchema = z
  .object({
    dateOfBirth: dateOfBirthSchema.nullable(),
  })
  .strict();
