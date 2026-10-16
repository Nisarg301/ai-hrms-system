import { z } from 'zod';

export const departmentSchema = z.object({
    title: z.string().trim().min(1, 'Title is required'),
    description: z.string().trim().min(1, 'Description is required'),
    status: z.enum(['active', 'inactive']),
});

export type DepartmentFormValues = z.infer<typeof departmentSchema>;
