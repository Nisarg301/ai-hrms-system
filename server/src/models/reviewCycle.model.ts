import { Schema, model, Document, Types } from 'mongoose';

export const CYCLE_STATUSES = ['draft', 'launched', 'released', 'closed'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const CYCLE_SCOPES = ['all', 'departments'] as const;
export type CycleScope = (typeof CYCLE_SCOPES)[number];

export interface ICycleQuestion {
  /** Stable id: answers point at it. */
  id: string;
  text: string;
}

/** A review round (e.g. "H2 2026"): who takes part, by when, and the questions everyone answers. */
export interface IReviewCycle extends Document {
  organizationId: Types.ObjectId;
  name: string;
  /** YYYY-MM-DD: the period reviewed; goals overlapping it are shown in each review. */
  periodFrom: string;
  periodTo: string;
  selfDueDate: string;
  managerDueDate: string;
  scope: CycleScope;
  departmentIds: Types.ObjectId[];
  questions: ICycleQuestion[];
  status: CycleStatus;
  participantCount: number;
  launchedAt: Date | null;
  launchedBy: Types.ObjectId | null;
  releasedAt: Date | null;
  releasedBy: Types.ObjectId | null;
  closedAt: Date | null;
  closedBy: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const reviewCycleSchema = new Schema<IReviewCycle>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true },
    periodFrom: { type: String, required: true },
    periodTo: { type: String, required: true },
    selfDueDate: { type: String, required: true },
    managerDueDate: { type: String, required: true },
    scope: { type: String, enum: CYCLE_SCOPES, default: 'all' },
    departmentIds: { type: [Schema.Types.ObjectId], ref: 'Department', default: [] },
    questions: { type: [{ id: { type: String, required: true }, text: { type: String, required: true }, _id: false }], default: [] },
    status: { type: String, enum: CYCLE_STATUSES, default: 'draft' },
    participantCount: { type: Number, default: 0 },
    launchedAt: { type: Date, default: null },
    launchedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    releasedAt: { type: Date, default: null },
    releasedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    closedAt: { type: Date, default: null },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

reviewCycleSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

export const ReviewCycleModel = model<IReviewCycle>('ReviewCycle', reviewCycleSchema);
