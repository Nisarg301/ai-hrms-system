import { z } from 'zod';
import { TASK_STATUSES } from '../models/task.model';
import { objectIdSchema } from './objectId';

// A due date is a plain calendar-date string, not a coerced Date -- no timezone
// conversion happens at any layer for this field. Format-checked, not full
// calendar-validity-checked (e.g. '2026-13-45' passes the regex); that's an
// intentional, minimal scope matching the design spec.
const dueDateSchema = z.string().trim().min(1).regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be in YYYY-MM-DD format');

// Every task belongs to a project and has at least one assigned member.
const memberIdsSchema = z.array(objectIdSchema).min(1, 'At least one member is required');

export const createTaskSchema = z.object({
  projectId: objectIdSchema,
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  dueDate: dueDateSchema,
  status: z.enum(TASK_STATUSES).default('todo'),
  userId: memberIdsSchema,
});

export const updateTaskSchema = z.object({
  projectId: objectIdSchema.optional(),
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  dueDate: dueDateSchema.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  userId: memberIdsSchema.optional(),
});

/** GET /tasks filters, next to page/limit/search/sortBy/sortDir. */
export const listTasksQuerySchema = z.object({
  projectId: objectIdSchema.optional(),
  /** One status, or several separated by commas: "todo,in-progress". */
  status: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(TASK_STATUSES)).min(1).optional()),
  /** Due dates are YYYY-MM-DD strings, so a range compares as text. */
  dueFrom: dueDateSchema.optional(),
  dueTo: dueDateSchema.optional(),
  /** Tasks that have this person among their members. */
  memberId: objectIdSchema.optional(),
});
