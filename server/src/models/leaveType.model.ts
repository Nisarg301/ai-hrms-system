import { Schema, model, Document, Types } from 'mongoose';

export interface ILeaveType extends Document {
  organizationId: Types.ObjectId;
  name: string;
  /** Short uppercase code, unique per organization (e.g. PL, UL). */
  code: string;
  isPaid: boolean;
  /** Days per calendar year; null = unlimited. */
  yearlyQuota: number | null;
  allowHalfDay: boolean;
  isActive: boolean;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const leaveTypeSchema = new Schema<ILeaveType>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    isPaid: { type: Boolean, default: true },
    yearlyQuota: { type: Number, default: null },
    allowHalfDay: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

leaveTypeSchema.index({ organizationId: 1, code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

export const LeaveTypeModel = model<ILeaveType>('LeaveType', leaveTypeSchema);
