import { Schema, model, Document, Types } from 'mongoose';

export const GOAL_STATUSES = ['on_track', 'at_risk', 'behind', 'completed', 'cancelled'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Someone's goal. Progress and status change only through check-ins, so each change has a history. */
export interface IGoal extends Document {
    organizationId: Types.ObjectId;
    ownerId: Types.ObjectId;
    title: string;
    description: string;
    /** YYYY-MM-DD */
    startDate: string;
    /** YYYY-MM-DD */
    dueDate: string;
    /** Informational percentage (Default 1): the sum isn't enforced. */
    weight: number | null;
    /** 0–100 */
    progress: number;
    status: GoalStatus;
    lastCheckInAt: Date | null;
    checkInCount: number;
    createdBy: Types.ObjectId;
    updatedBy: Types.ObjectId | null;
    isDeleted: boolean;
    deletedAt: Date | null;
    deletedBy: Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}

const goalSchema = new Schema<IGoal>(
    {
        organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
        ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        title: { type: String, required: true, trim: true },
        description: { type: String, default: '' },
        startDate: { type: String, required: true },
        dueDate: { type: String, required: true },
        weight: { type: Number, default: null },
        progress: { type: Number, default: 0 },
        status: { type: String, enum: GOAL_STATUSES, default: 'on_track' },
        lastCheckInAt: { type: Date, default: null },
        checkInCount: { type: Number, default: 0 },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
        deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true }
);

goalSchema.index({ organizationId: 1, ownerId: 1, dueDate: 1 });

export const GoalModel = model<IGoal>('Goal', goalSchema);
