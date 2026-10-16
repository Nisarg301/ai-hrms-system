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
