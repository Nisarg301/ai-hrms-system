import { z } from 'zod';
import { HALF_DAYS, LEAVE_STATUSES } from '../models/leaveRequest.model';
import { isoDateSchema } from './date';
import { objectIdSchema } from './objectId';

const code = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{1,6}$/, 'Use 1 to 6 letters or digits'));
// null = unlimited.
const quota = z.number().int().min(0).max(366).nullable();

export const createLeaveTypeSchema = z.object({
  name: z.string().trim().min(1).max(50),
  code,
  isPaid: z.boolean().default(true),
  yearlyQuota: quota.default(null),
  allowHalfDay: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export const updateLeaveTypeSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  code: code.optional(),
  isPaid: z.boolean().optional(),
  yearlyQuota: quota.optional(),
  allowHalfDay: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// Query strings arrive as '' when a field is left empty.
const emptyToNull = (v: unknown) => (v === '' || v === 'null' ? null : v);
const halfDay = z.preprocess(emptyToNull, z.enum(HALF_DAYS).nullable()).default(null);

export const applyLeaveSchema = z.object({
  leaveTypeId: objectIdSchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  halfDay,
  reason: z.string().trim().max(500).default(''),
});

/** ORG_ADMIN recording leave for someone; it's approved straight away. */
export const recordLeaveSchema = applyLeaveSchema.extend({
  employeeId: objectIdSchema,
});

export const previewLeaveQuerySchema = z.object({
  leaveTypeId: objectIdSchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  halfDay,
  /** ORG_ADMIN only: preview for this employee, as a recording (backdating allowed). */
  employeeId: objectIdSchema.optional(),
});

export const decideLeaveSchema = z.object({
  note: z.string().trim().max(500).default(''),
});

export const listLeaveQuerySchema = z.object({
  status: z.enum(LEAVE_STATUSES).optional(),
  employeeId: objectIdSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export const yearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

/** GET /leave/balances: an ORG_ADMIN may ask for someone else's. */
export const balancesQuerySchema = yearQuerySchema.extend({
  employeeId: objectIdSchema.optional(),
});
