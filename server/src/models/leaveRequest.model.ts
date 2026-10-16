import { Schema, model, Document, Types } from 'mongoose';

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const HALF_DAYS = ['first', 'second'] as const;
export type HalfDay = (typeof HALF_DAYS)[number];

export interface ILeaveRequest extends Document {
  organizationId: Types.ObjectId;
  employeeId: Types.ObjectId;
  leaveTypeId: Types.ObjectId;
  /** YYYY-MM-DD, inclusive, within one calendar year. */
  startDate: string;
  endDate: string;
  /** Set for a half day (startDate === endDate). */
  halfDay: HalfDay | null;
  /** Working days, computed by the server (0.5 steps). */
  days: number;
  reason: string;
  status: LeaveStatus;
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
  decisionNote: string;
  // Present only so BaseRepository's not-deleted filter matches; requests are
  // never deleted, they're cancelled.
  isDeleted: boolean;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const leaveRequestSchema = new Schema<ILeaveRequest>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    leaveTypeId: { type: Schema.Types.ObjectId, ref: 'LeaveType', required: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    halfDay: { type: String, enum: [...HALF_DAYS, null], default: null },
    days: { type: Number, required: true },
    reason: { type: String, trim: true, default: '' },
    status: { type: String, enum: LEAVE_STATUSES, default: 'pending' },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, default: '' },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

leaveRequestSchema.index({ organizationId: 1, status: 1, startDate: 1 });
leaveRequestSchema.index({ organizationId: 1, employeeId: 1, startDate: 1 });

export const LeaveRequestModel = model<ILeaveRequest>('LeaveRequest', leaveRequestSchema);
