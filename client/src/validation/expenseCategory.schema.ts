import { z } from 'zod';

const MAX_RUPEES = 1_000_000;

/** Amounts are typed in rupees here and sent in paise. */
export const expenseCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Keep it under 60 characters'),
  /** null = no limit. */
  limitRupees: z.number().gt(0, 'A limit must be more than zero').max(MAX_RUPEES, 'At most ₹10,00,000').nullable(),
  /** 0 = a receipt is always needed. */
  receiptAboveRupees: z.number({ message: 'Enter an amount (0 means always)' }).min(0, 'Can’t be negative').max(MAX_RUPEES, 'At most ₹10,00,000'),
  isActive: z.boolean(),
});

export type ExpenseCategoryFormValues = z.infer<typeof expenseCategorySchema>;
