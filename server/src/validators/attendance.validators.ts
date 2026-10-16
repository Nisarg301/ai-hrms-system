import { z } from 'zod';
import { ATTENDANCE_REQUEST_KINDS, ATTENDANCE_REQUEST_STATUSES } from '../models/attendanceRequest.model';
import { isoDateSchema } from './date';
import { objectIdSchema } from './objectId';

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, e.g. 09:30');

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM, e.g. 2026-10');

export const monthQuerySchema = z.object({
  month: monthSchema.optional(),
});

/** The full schedule is always sent together, so the cross-field checks see every value. */
export const updateSettingsSchema = z
  .object({
    shiftStart: hm,
    shiftEnd: hm,
    graceMinutes: z.number().int().min(0).max(240),
    fullDayMinutes: z.number().int().min(30).max(1440),
    halfDayMinutes: z.number().int().min(15).max(1440),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.shiftEnd <= v.shiftStart) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['shiftEnd'], message: 'The shift must end after it starts' });
    }
    if (v.halfDayMinutes > v.fullDayMinutes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['halfDayMinutes'], message: "A half day can't need more time than a full day" });
    }
  });

const reason = z.string().trim().min(1, 'Give a reason').max(500);

/** An employee's request: a fix to one day, or work from home for a range. */
export const createAttendanceRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('regularization'), date: isoDateSchema, clockIn: hm, clockOut: hm, reason }).strict(),
  z.object({ kind: z.literal('wfh'), startDate: isoDateSchema, endDate: isoDateSchema, reason }).strict(),
]);

/** ORG_ADMIN records a fix for someone; the reason is optional. */
export const recordFixSchema = z
  .object({
    employeeId: objectIdSchema,
    date: isoDateSchema,
    clockIn: hm,
    clockOut: hm,
    reason: z.string().trim().max(500).default(''),
  })
  .strict();

export const decideAttendanceSchema = z.object({
  note: z.string().trim().max(500).default(''),
});

export const listAttendanceRequestsQuerySchema = z.object({
  kind: z.enum(ATTENDANCE_REQUEST_KINDS).optional(),
  status: z.enum(ATTENDANCE_REQUEST_STATUSES).optional(),
  employeeId: objectIdSchema.optional(),
});

export const teamDayQuerySchema = z.object({
  date: isoDateSchema.optional(),
  departmentId: objectIdSchema.optional(),
});

export const teamMonthQuerySchema = z.object({
  month: monthSchema.optional(),
  departmentId: objectIdSchema.optional(),
});
