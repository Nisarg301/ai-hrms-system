import { z } from 'zod';

export const taskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().min(1, 'Description is required'),
  dueDate: z.string().trim().min(1, 'Due date is required').regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be in YYYY-MM-DD format'),
  status: z.enum(['todo', 'in-progress', 'done', 'blocked']),
  projectId: z.string().trim().min(1, 'Project is required'),
  userId: z.array(z.string()).min(1, 'Member is required'),
});

export type TaskFormValues = z.infer<typeof taskSchema>;
