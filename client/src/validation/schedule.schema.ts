import { z } from 'zod';

/** The schedule as the form edits it: day lengths in hours, converted to minutes on save. */
export const scheduleFormSchema = z
  .object({
    shiftStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick a start time'),
    shiftEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick an end time'),
    graceMinutes: z.number({ invalid_type_error: 'Enter minutes' }).int().min(0).max(240),
    fullDayHours: z.number({ invalid_type_error: 'Enter hours' }).min(0.5).max(24),
    halfDayHours: z.number({ invalid_type_error: 'Enter hours' }).min(0.25).max(24),
  })
  .superRefine((v, ctx) => {
    if (v.shiftEnd <= v.shiftStart) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['shiftEnd'], message: 'The shift must end after it starts' });
    if (v.halfDayHours > v.fullDayHours) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['halfDayHours'], message: "A half day can't be longer than a full day" });
  });

export type ScheduleFormValues = z.infer<typeof scheduleFormSchema>;
