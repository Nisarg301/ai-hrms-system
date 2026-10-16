import { Schema, model, Document, Types } from 'mongoose';
import { GOAL_STATUSES, GoalStatus } from './goal.model';

export const REVIEW_PARTS = ['self', 'manager'] as const;
export type ReviewPart = (typeof REVIEW_PARTS)[number];

/** One side of a review: answers to the cycle's questions and a 1–5 rating; a draft until submitted. */
export interface IReviewPart {
  answers: { questionId: string; text: string }[];
  rating: number | null;
  /** null = a draft (or not started, when nothing is saved). */
  submittedAt: Date | null;
  submittedBy: Types.ObjectId | null;
  savedAt: Date | null;
  /** YYYY-MM-DD of the last reminder sent about this part (once a day). */
  remindedOn: string | null;
}

export interface IGoalSnapshot {
  goalId: Types.ObjectId;
  title: string;
  progress: number;
  status: GoalStatus;
  weight: number | null;
  dueDate: string;
}

/** One participant's review in a cycle. */
export interface IReview extends Document {
  organizationId: Types.ObjectId;
  cycleId: Types.ObjectId;
  employeeId: Types.ObjectId;
  /** Fixed at launch (their manager then); null = any ORG_ADMIN writes it (P2). */
  reviewerId: Types.ObjectId | null;
  /** Their department at launch, for filters and the summary. */
  departmentId: Types.ObjectId | null;
  self: IReviewPart;
  manager: IReviewPart;
  /** Their goals overlapping the period, as of the latest part submitted. */
  goalsSnapshot: IGoalSnapshot[];
  goalsSnapshotAt: Date | null;
  /** When the employee could first see the manager's review. */
  releasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const partSchema = new Schema<IReviewPart>(
  {
    answers: { type: [{ questionId: String, text: String, _id: false }], default: [] },
    rating: { type: Number, default: null },
    submittedAt: { type: Date, default: null },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    savedAt: { type: Date, default: null },
    remindedOn: { type: String, default: null },
  },
  { _id: false }
);

const reviewSchema = new Schema<IReview>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    cycleId: { type: Schema.Types.ObjectId, ref: 'ReviewCycle', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reviewerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    self: { type: partSchema, default: () => ({}) },
    manager: { type: partSchema, default: () => ({}) },
    goalsSnapshot: {
      type: [
        {
          goalId: { type: Schema.Types.ObjectId, ref: 'Goal' },
          title: String,
          progress: Number,
          status: { type: String, enum: GOAL_STATUSES },
          weight: { type: Number, default: null },
          dueDate: String,
          _id: false,
        },
      ],
      default: [],
    },
    goalsSnapshotAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

reviewSchema.index({ cycleId: 1, employeeId: 1 }, { unique: true });
reviewSchema.index({ organizationId: 1, employeeId: 1 });
reviewSchema.index({ organizationId: 1, reviewerId: 1 });

export const ReviewModel = model<IReview>('Review', reviewSchema);
