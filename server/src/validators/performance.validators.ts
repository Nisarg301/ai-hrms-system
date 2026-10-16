import { z } from 'zod';
import { GOAL_STATUSES } from '../models/goal.model';
import { REVIEW_PARTS } from '../models/review.model';
import { CYCLE_SCOPES } from '../models/reviewCycle.model';
import { isoDateSchema } from './date';
import { objectIdSchema } from './objectId';

const goalFields = {
  title: z.string().trim().min(1, 'Give the goal a title').max(120, 'Keep the title under 120 characters'),
  description: z.string().trim().max(2000, 'Keep the description under 2,000 characters'),
  startDate: isoDateSchema,
  dueDate: isoDateSchema,
  /** Informational; null = none. */
  weight: z.number().int('Whole numbers only').min(1, 'At least 1%').max(100, 'At most 100%').nullable(),
};

const datesInOrder = (v: { startDate?: string; dueDate?: string }) => !v.startDate || !v.dueDate || v.startDate <= v.dueDate;
const DATES_MESSAGE = { message: 'The due date can’t be before the start date', path: ['dueDate'] };

/** A goal for myself, or (`ownerId`) for a direct report or, as an admin, anyone. */
export const createGoalSchema = z
  .object({
    ...goalFields,
    description: goalFields.description.default(''),
    weight: goalFields.weight.default(null),
    ownerId: objectIdSchema.optional(),
  })
  .strict()
  .refine(datesInOrder, DATES_MESSAGE);

/** Progress and status change through check-ins, not edits. */
export const updateGoalSchema = z
  .object({
    title: goalFields.title.optional(),
    description: goalFields.description.optional(),
    startDate: goalFields.startDate.optional(),
    dueDate: goalFields.dueDate.optional(),
    weight: goalFields.weight.optional(),
  })
  .strict()
  .refine(datesInOrder, DATES_MESSAGE);

export const checkInSchema = z
  .object({
    progress: z.number({ invalid_type_error: 'Enter the progress' }).int('Whole numbers only').min(0, 'At least 0%').max(100, 'At most 100%'),
    status: z.enum(GOAL_STATUSES, { errorMap: () => ({ message: 'Choose a status' }) }),
    comment: z.string().trim().max(1000, 'Keep the comment under 1,000 characters').default(''),
  })
  .strict();

export const teamGoalsQuerySchema = z.object({
  ownerId: objectIdSchema.optional(),
  status: z.enum(GOAL_STATUSES).optional(),
});

// ---------------------------------------------------------------- review cycles

export const MAX_CYCLE_QUESTIONS = 10;

const questionSchema = z
  .object({
    id: z.string().trim().min(1).max(40).optional(),
    text: z.string().trim().min(1, 'A question can’t be empty').max(300, 'Keep each question under 300 characters'),
  })
  .strict();

const cycleFields = {
  name: z.string().trim().min(1, 'Name the cycle').max(80, 'Keep the name under 80 characters'),
  periodFrom: isoDateSchema,
  periodTo: isoDateSchema,
  selfDueDate: isoDateSchema,
  managerDueDate: isoDateSchema,
  scope: z.enum(CYCLE_SCOPES),
  departmentIds: z.array(objectIdSchema).max(50),
  questions: z.array(questionSchema).min(1, 'Add at least one question').max(MAX_CYCLE_QUESTIONS, `At most ${MAX_CYCLE_QUESTIONS} questions`),
};

/** The order of the dates and the departments are checked once a draft's edits are merged in. */
export const createCycleSchema = z
  .object({
    ...cycleFields,
    scope: cycleFields.scope.default('all'),
    departmentIds: cycleFields.departmentIds.default([]),
    // Left out: the default questions (Default 6).
    questions: cycleFields.questions.optional(),
  })
  .strict();

export const updateCycleSchema = z
  .object({
    name: cycleFields.name.optional(),
    periodFrom: cycleFields.periodFrom.optional(),
    periodTo: cycleFields.periodTo.optional(),
    selfDueDate: cycleFields.selfDueDate.optional(),
    managerDueDate: cycleFields.managerDueDate.optional(),
    scope: cycleFields.scope.optional(),
    departmentIds: cycleFields.departmentIds.optional(),
    questions: cycleFields.questions.optional(),
  })
  .strict();

export const cycleReviewsQuerySchema = z.object({
  status: z.enum(['self_pending', 'manager_pending', 'complete', 'released']).optional(),
  departmentId: objectIdSchema.optional(),
});

// ---------------------------------------------------------------- reviews

/** A draft can be partial; submitting checks every question and the rating. */
export const reviewPartSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            questionId: z.string().trim().min(1).max(40),
            text: z.string().trim().max(5000, 'Keep each answer under 5,000 characters'),
          })
          .strict()
      )
      .max(MAX_CYCLE_QUESTIONS)
      .default([]),
    rating: z.number().int('Choose a rating from 1 to 5').min(1, 'Choose a rating from 1 to 5').max(5, 'Choose a rating from 1 to 5').nullable().default(null),
  })
  .strict();

export const reopenSchema = z.object({ part: z.enum(REVIEW_PARTS) }).strict();

/** A person, or null for "any ORG_ADMIN". */
export const reassignSchema = z.object({ reviewerId: objectIdSchema.nullable() }).strict();

export const exportReviewsQuerySchema = z.object({ cycleId: objectIdSchema });
