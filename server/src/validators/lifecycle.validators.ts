import { z } from 'zod';
import { ASSIGNEE_KINDS, CHECKLIST_TASK_TYPES, LIFECYCLE_KINDS } from '../models/checklistTemplate.model';
import { OFFBOARDING_REASONS, PROCESS_STATUSES } from '../models/lifecycleProcess.model';
import { isoDateSchema } from './date';
import { objectIdSchema } from './objectId';

export const MAX_TEMPLATE_TASKS = 40;
export const MAX_FORM_QUESTIONS = 10;
export const MIN_DUE_OFFSET = -90;
export const MAX_DUE_OFFSET = 180;

const linkSchema = z
  .string()
  .trim()
  .max(500, 'Keep the link under 500 characters')
  .refine((v) => (v.startsWith('/') && !v.startsWith('//')) || /^https?:\/\/\S+$/i.test(v), 'Use an app path (/…) or an http(s) link');

/** One task in a template. Questions are kept only on a form. */
export const templateTaskSchema = z
  .object({
    key: z.string().trim().min(1).max(40).optional(),
    title: z.string().trim().min(1, 'Give the task a title').max(120, 'Keep the title under 120 characters'),
    instructions: z.string().trim().max(1000, 'Keep the instructions under 1,000 characters').default(''),
    assignee: z.object({
      kind: z.enum(ASSIGNEE_KINDS),
      userId: objectIdSchema.nullable().optional(),
    }),
    dueOffsetDays: z
      .number({ invalid_type_error: 'Enter the number of days' })
      .int('Whole days only')
      .min(MIN_DUE_OFFSET, `At most ${-MIN_DUE_OFFSET} days before`)
      .max(MAX_DUE_OFFSET, `At most ${MAX_DUE_OFFSET} days after`),
    type: z.enum(CHECKLIST_TASK_TYPES),
    questions: z
      .array(z.string().trim().min(1, 'A question can’t be empty').max(200, 'Keep each question under 200 characters'))
      .max(MAX_FORM_QUESTIONS, `At most ${MAX_FORM_QUESTIONS} questions`)
      .default([]),
    link: z.union([linkSchema, z.literal('')]).nullable().optional(),
  })
  .superRefine((t, ctx) => {
    if (t.assignee.kind === 'person' && !t.assignee.userId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['assignee'], message: 'Choose the person' });
    }
    if (t.type === 'form' && t.questions.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['questions'], message: 'A form needs at least one question' });
    }
  })
  .transform((t) => ({
    ...t,
    assignee: { kind: t.assignee.kind, userId: t.assignee.kind === 'person' ? (t.assignee.userId ?? null) : null },
    questions: t.type === 'form' ? t.questions : [],
    link: t.link ? t.link : null,
  }));

export type TemplateTaskInput = z.output<typeof templateTaskSchema>;

/**
 * A template's tasks. Each task is checked on its own so the message says which one
 * ("Task 4: Give the task a title"): the 400 body flattens nested paths to `tasks`.
 */
const templateTasksSchema = z
  .array(z.unknown())
  .min(1, 'Add at least one task')
  .max(MAX_TEMPLATE_TASKS, `At most ${MAX_TEMPLATE_TASKS} tasks`)
  .superRefine((tasks, ctx) => {
    tasks.forEach((task, i) => {
      const parsed = templateTaskSchema.safeParse(task);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: `Task ${i + 1}: ${issue.message}` });
        }
      }
    });
  })
  .transform((tasks) => tasks.map((t) => templateTaskSchema.parse(t)));

const templateNameSchema = z.string().trim().min(1, 'Name is required').max(80, 'Keep the name under 80 characters');

export const createTemplateSchema = z
  .object({
    name: templateNameSchema,
    kind: z.enum(LIFECYCLE_KINDS),
    tasks: templateTasksSchema,
  })
  .strict();

/** The kind can't change: a template's tasks are written for joining or for leaving. */
export const updateTemplateSchema = z
  .object({
    name: templateNameSchema.optional(),
    tasks: templateTasksSchema.optional(),
  })
  .strict();

export const templateListQuerySchema = z.object({
  kind: z.enum(LIFECYCLE_KINDS).optional(),
});

// ---------------------------------------------------------------- processes

/** Also the `onboarding` part of POST /employees. */
export const onboardingOptionsSchema = z
  .object({
    templateId: objectIdSchema,
    buddyId: objectIdSchema.nullable().optional(),
  })
  .strict();

export const startOnboardingSchema = onboardingOptionsSchema.extend({ employeeId: objectIdSchema }).strict();

export const startOffboardingSchema = z
  .object({
    employeeId: objectIdSchema,
    templateId: objectIdSchema,
    lastWorkingDay: isoDateSchema,
    reason: z.enum(OFFBOARDING_REASONS, { errorMap: () => ({ message: 'Choose a reason' }) }),
    adminNotes: z.string().trim().max(2000, 'Keep the notes under 2,000 characters').default(''),
  })
  .strict();

export const candidatesQuerySchema = z.object({
  kind: z.enum(LIFECYCLE_KINDS),
});

export const processListQuerySchema = z.object({
  kind: z.enum(LIFECYCLE_KINDS).optional(),
  status: z.enum(PROCESS_STATUSES).optional(),
  page: z.unknown().optional(),
  limit: z.unknown().optional(),
});

export const completeProcessSchema = z
  .object({
    /** Skip whatever is still pending, instead of refusing. */
    skipRemaining: z.boolean().default(false),
  })
  .strict();

export const cancelProcessSchema = z
  .object({
    reason: z.string().trim().min(1, 'Say why it’s being cancelled').max(500, 'Keep it under 500 characters'),
  })
  .strict();

// ---------------------------------------------------------------- tasks

/** What completing needs depends on the task's type; the controller checks that. */
export const completeTaskSchema = z
  .object({
    note: z.string().trim().max(1000, 'Keep the note under 1,000 characters').default(''),
    /** Form answers, in question order. */
    answers: z.array(z.string().trim().max(2000, 'Keep each answer under 2,000 characters')).max(MAX_FORM_QUESTIONS).optional(),
    acknowledged: z.boolean().optional(),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    /** A person, or null for any ORG_ADMIN. */
    assigneeId: objectIdSchema.nullable().optional(),
    dueDate: isoDateSchema.optional(),
  })
  .strict()
  .refine((v) => v.assigneeId !== undefined || v.dueDate !== undefined, 'Change the assignee or the due date');

export const skipTaskSchema = z
  .object({
    reason: z.string().trim().min(1, 'Say why it’s being skipped').max(500, 'Keep it under 500 characters'),
  })
  .strict();

/** A one-off task added to a running process: for a person, or for the admins (null). */
export const adHocTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the task a title').max(120, 'Keep the title under 120 characters'),
    instructions: z.string().trim().max(1000, 'Keep the instructions under 1,000 characters').default(''),
    type: z.enum(CHECKLIST_TASK_TYPES),
    questions: z
      .array(z.string().trim().min(1, 'A question can’t be empty').max(200, 'Keep each question under 200 characters'))
      .max(MAX_FORM_QUESTIONS, `At most ${MAX_FORM_QUESTIONS} questions`)
      .default([]),
    link: z.union([linkSchema, z.literal('')]).nullable().optional(),
    assigneeId: objectIdSchema.nullable(),
    dueDate: isoDateSchema,
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.type === 'form' && t.questions.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['questions'], message: 'A form needs at least one question' });
    }
  })
  .transform((t) => ({ ...t, questions: t.type === 'form' ? t.questions : [], link: t.link ? t.link : null }));
