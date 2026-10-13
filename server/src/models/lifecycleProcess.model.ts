import { Schema, model, Document, Types } from 'mongoose';
import { LIFECYCLE_KINDS, LifecycleKind } from './checklistTemplate.model';

export const PROCESS_STATUSES = ['active', 'completed', 'cancelled'] as const;
export type ProcessStatus = (typeof PROCESS_STATUSES)[number];

export const OFFBOARDING_REASONS = ['resignation', 'termination', 'end_of_contract', 'other'] as const;
export type OffboardingReason = (typeof OFFBOARDING_REASONS)[number];

/** One person's onboarding or offboarding: a checklist of tasks copied from a template. */
export interface ILifecycleProcess extends Document {
  organizationId: Types.ObjectId;
  employeeId: Types.ObjectId;
  kind: LifecycleKind;
  templateId: Types.ObjectId;
  /** As it was when the process started (the template may be renamed or deleted later). */
  templateName: string;
  /** YYYY-MM-DD: the joining date (onboarding) or the last working day (offboarding); due dates count from it. */
  anchorDate: string;
  buddyId: Types.ObjectId | null;
  /** Offboarding only; ORG_ADMIN-only, like the notes. */
  reason: OffboardingReason | null;
  adminNotes: string;
  status: ProcessStatus;
  startedBy: Types.ObjectId;
  completedBy: Types.ObjectId | null;
  completedAt: Date | null;
  /** Completing offboarding disabled the account (O3). */
  accountDisabled: boolean;
  cancelledBy: Types.ObjectId | null;
  cancelledAt: Date | null;
  cancelledReason: string;
  /** When the admins were told nothing is pending (once; cleared when a task is added). */
  readyNotifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const lifecycleProcessSchema = new Schema<ILifecycleProcess>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: LIFECYCLE_KINDS, required: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'ChecklistTemplate', required: true },
    templateName: { type: String, required: true },
    anchorDate: { type: String, required: true },
    buddyId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reason: { type: String, enum: [...OFFBOARDING_REASONS, null], default: null },
    adminNotes: { type: String, default: '' },
    status: { type: String, enum: PROCESS_STATUSES, default: 'active' },
    startedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    completedAt: { type: Date, default: null },
    accountDisabled: { type: Boolean, default: false },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    cancelledReason: { type: String, default: '' },
    readyNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One active onboarding and one active offboarding per person.
lifecycleProcessSchema.index({ organizationId: 1, employeeId: 1, kind: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
lifecycleProcessSchema.index({ organizationId: 1, kind: 1, status: 1, anchorDate: 1 });

export const LifecycleProcessModel = model<ILifecycleProcess>('LifecycleProcess', lifecycleProcessSchema);
