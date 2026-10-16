import { z } from 'zod';

const answer = z.string().trim().max(1000, 'Keep it under 1,000 characters');

export const introductionSchema = z.object({
  about: answer,
  hobbies: answer,
  lovesAboutJob: answer,
});

export type IntroductionFormValues = z.infer<typeof introductionSchema>;
