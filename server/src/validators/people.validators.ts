import { z } from 'zod';

export const peopleSearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Type something to search').max(100),
});
