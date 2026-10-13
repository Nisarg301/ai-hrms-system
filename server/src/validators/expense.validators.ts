import { z } from 'zod';
import { CLAIM_STATUSES } from '../models/expenseClaim.model';
import { MAX_AMOUNT_PAISE } from '../services/expense.service';
import { todayIso } from '../utils/dates';
import { isoDateSchema } from './date';
import { objectIdSchema } from './objectId';

const paise = z.number().int('Whole paise only').min(0).max(MAX_AMOUNT_PAISE);

export const createCategorySchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(60),
    /** null = no limit. */
    limitPaise: paise.min(1, 'A limit must be more than zero').nullable().default(null),
    receiptRequiredAbovePaise: paise.default(50000),
    isActive: z.boolean().default(true),
  })
  .strict();

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(60).optional(),
    limitPaise: paise.min(1, 'A limit must be more than zero').nullable().optional(),
    receiptRequiredAbovePaise: paise.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const claimSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the claim a title').max(120),
  })
  .strict();

export const itemSchema = z
  .object({
    date: isoDateSchema,
    categoryId: objectIdSchema,
    amountPaise: z.number().int('Whole paise only').min(1, 'Enter an amount').max(MAX_AMOUNT_PAISE, 'At most ₹10,00,000 per expense'),
    merchant: z.string().trim().min(1, 'Say where you spent it').max(120),
    note: z.string().trim().max(500).default(''),
  })
  .strict();

export const updateItemSchema = itemSchema.partial().strict();

export const myClaimsQuerySchema = z.object({
  status: z.enum(CLAIM_STATUSES).optional(),
});

export const approveSchema = z
  .object({
    note: z.string().trim().max(500).default(''),
  })
  .strict();

/** A rejection must say what to change. */
export const rejectSchema = z
  .object({
    note: z.string().trim().min(1, 'Say why, so they can fix it').max(500),
  })
  .strict();

export const paySchema = z
  .object({
    claimIds: z.array(objectIdSchema).min(1, 'Choose at least one claim').max(100, 'At most 100 claims at a time'),
    paidOn: isoDateSchema.refine((d) => d <= todayIso(), "The payment date can't be in the future"),
    reference: z.string().trim().min(1, 'Enter the payment reference (e.g. the UTR)').max(100),
  })
  .strict();

/** Admins never see drafts, so a draft filter isn't offered. */
const adminStatus = z.enum(['submitted', 'approved', 'rejected', 'paid']);

function rangeCheck<T extends { from?: string; to?: string }>(v: T, ctx: z.RefinementCtx) {
  if (v.from && v.to && v.from > v.to) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: "The end date can't be before the start date" });
  }
}

/** GET /expenses (ORG_ADMIN). `from`/`to` filter by expense date. */
export const adminListQuerySchema = z
  .object({
    status: adminStatus.optional(),
    employeeId: objectIdSchema.optional(),
    categoryId: objectIdSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    page: z.unknown().optional(),
    limit: z.unknown().optional(),
  })
  .superRefine(rangeCheck);

/** Summary and export: an expense-date range, at most a year long (defaults to this month). */
export const rangeQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .superRefine(rangeCheck)
  .superRefine((v, ctx) => {
    if (v.from && v.to && new Date(v.to).getTime() - new Date(v.from).getTime() > 366 * 24 * 60 * 60 * 1000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Choose a range of at most a year' });
    }
  });
