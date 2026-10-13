import { Schema, model, Document, Types } from 'mongoose';
import { GOAL_STATUSES, GoalStatus } from './goal.model';

/** One update to a goal: where it stands now, and a comment. */
export interface IGoalCheckIn extends Document {
  organizationId: Types.ObjectId;
  goalId: Types.ObjectId;
  authorId: Types.ObjectId;
  progress: number;
  status: GoalStatus;
  /** Where it was before, for the timeline. */
  previousProgress: number;
  previousStatus: GoalStatus;
  comment: string;
  createdAt: Date;
  updatedAt: Date;
}

const goalCheckInSchema = new Schema<IGoalCheckIn>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    goalId: { type: Schema.Types.ObjectId, ref: 'Goal', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    progress: { type: Number, required: true },
    status: { type: String, enum: GOAL_STATUSES, required: true },
    previousProgress: { type: Number, required: true },
    previousStatus: { type: String, enum: GOAL_STATUSES, required: true },
    comment: { type: String, default: '' },
  },
  { timestamps: true }
);

goalCheckInSchema.index({ goalId: 1, createdAt: -1 });

export const GoalCheckInModel = model<IGoalCheckIn>('GoalCheckIn', goalCheckInSchema);
