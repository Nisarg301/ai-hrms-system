import { z } from 'zod';

export const leaveTypeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(50, 'Keep it under 50 characters'),
  code: z
    .string()
    .trim()
    .min(1, 'Code is required')
    .regex(/^[A-Za-z0-9]{1,6}$/, 'Use 1 to 6 letters or digits'),
  isPaid: z.boolean(),
  /** null = unlimited */
  yearlyQuota: z.number().int('Whole days only').min(0, 'Can’t be negative').max(366, 'At most 366 days').nullable(),
  allowHalfDay: z.boolean(),
  isActive: z.boolean(),
});

export type LeaveTypeFormValues = z.infer<typeof leaveTypeSchema>;
