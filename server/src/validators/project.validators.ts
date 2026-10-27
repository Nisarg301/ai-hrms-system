import { z } from 'zod';
import { PROJECT_STATUSES } from '../models/project.model';
import { isoDateSchema } from './date';

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

/** GET /projects filters, next to page/limit/search/sortBy/sortDir. Deadlines are days in APP_TIMEZONE. */
export const listProjectsQuerySchema = z.object({
  /** One status, or several separated by commas: "planning,active". */
  status: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(PROJECT_STATUSES)).min(1).optional()),
  dueFrom: isoDateSchema.optional(),
  dueTo: isoDateSchema.optional(),
});
