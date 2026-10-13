import { Schema, model, Document, Types } from 'mongoose';
import { ASSIGNEE_KINDS, AssigneeKind, CHECKLIST_TASK_TYPES, ChecklistTaskType, LIFECYCLE_KINDS, LifecycleKind } from './checklistTemplate.model';

export const LIFECYCLE_TASK_STATUSES = ['pending', 'done', 'skipped'] as const;
export type LifecycleTaskStatus = (typeof LIFECYCLE_TASK_STATUSES)[number];

export interface ITaskFile {
  fileId: Types.ObjectId;
  originalName: string;
  mimeType: string;
  size: number;
}

/** A task in a running process: copied from the template, with its assignee and due date fixed at the start. */
export interface ILifecycleTask extends Document {
  organizationId: Types.ObjectId;
  processId: Types.ObjectId;
  /** Whose process it is. */
  employeeId: Types.ObjectId;
  kind: LifecycleKind;
  order: number;
  title: string;
  instructions: string;
  type: ChecklistTaskType;
  questions: string[];
  link: string | null;
  /** As written in the template (for "Manager", "Buddy" labels); ad-hoc tasks are 'person' or 'admin'. */
  assigneeKind: AssigneeKind;
  /** The person who does it; null = any ORG_ADMIN. */
  assigneeId: Types.ObjectId | null;
  /** YYYY-MM-DD */
  dueDate: string;
  status: LifecycleTaskStatus;
  completedBy: Types.ObjectId | null;
  completedAt: Date | null;
  note: string;
  files: ITaskFile[];
  /** Form answers, in question order. ORG_ADMIN-only (an exit interview, say). */
  answers: { question: string; text: string }[];
  acknowledged: boolean;
  skippedBy: Types.ObjectId | null;
  skippedAt: Date | null;
  skipReason: string;
  /** Added to the running process by an ORG_ADMIN, not from the template. */
  adHoc: boolean;
  /** YYYY-MM-DD of the last reminder digest that included it (one a day). */
  lastRemindedOn: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const taskFileSchema = new Schema<ITaskFile>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
  },
  { _id: false }
);

const lifecycleTaskSchema = new Schema<ILifecycleTask>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    processId: { type: Schema.Types.ObjectId, ref: 'LifecycleProcess', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: LIFECYCLE_KINDS, required: true },
    order: { type: Number, required: true },
    title: { type: String, required: true },
    instructions: { type: String, default: '' },
    type: { type: String, enum: CHECKLIST_TASK_TYPES, required: true },
    questions: { type: [String], default: [] },
    link: { type: String, default: null },
    assigneeKind: { type: String, enum: ASSIGNEE_KINDS, required: true },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    dueDate: { type: String, required: true },
    status: { type: String, enum: LIFECYCLE_TASK_STATUSES, default: 'pending' },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    completedAt: { type: Date, default: null },
    note: { type: String, default: '' },
    files: { type: [taskFileSchema], default: [] },
    answers: { type: [{ question: String, text: String, _id: false }], default: [] },
    acknowledged: { type: Boolean, default: false },
    skippedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    skippedAt: { type: Date, default: null },
    skipReason: { type: String, default: '' },
    adHoc: { type: Boolean, default: false },
    lastRemindedOn: { type: String, default: null },
  },
  { timestamps: true }
);

lifecycleTaskSchema.index({ organizationId: 1, assigneeId: 1, status: 1, dueDate: 1 });
lifecycleTaskSchema.index({ processId: 1, order: 1 });

export const LifecycleTaskModel = model<ILifecycleTask>('LifecycleTask', lifecycleTaskSchema);
