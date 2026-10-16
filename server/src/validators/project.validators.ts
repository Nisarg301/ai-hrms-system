import { z } from 'zod';
import { PROJECT_STATUSES } from '../models/project.model';

export const createProjectSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  deadline: z.string().trim().min(1).pipe(z.coerce.date()),
  status: z.enum(PROJECT_STATUSES).default('planning'),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  deadline: z.string().trim().min(1).pipe(z.coerce.date()).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
});
