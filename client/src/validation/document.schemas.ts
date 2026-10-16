import { z } from 'zod';

export const documentSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().min(1, 'Description is required'),
  category: z.string().trim().min(1, 'Category is required'),
  status: z.enum(['active', 'archived']),
  file: z.union([z.instanceof(File), z.string()]).optional(),
});

export type DocumentFormValues = z.infer<typeof documentSchema>;

