import { z } from 'zod';

export const projectSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().trim().min(1, 'Description is required'),
  deadline: z.string().trim().min(1, 'Deadline is required'),
  status: z.enum(['planning', 'active', 'completed', 'on-hold']),
});

export type ProjectFormValues = z.infer<typeof projectSchema>;
