import { Schema, model, Document, Types } from 'mongoose';

export const ATTENDANCE_REQUEST_KINDS = ['regularization', 'wfh'] as const;
export type AttendanceRequestKind = (typeof ATTENDANCE_REQUEST_KINDS)[number];
export const ATTENDANCE_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type AttendanceRequestStatus = (typeof ATTENDANCE_REQUEST_STATUSES)[number];

/**
 * A fix to one day's punches ("regularization") or a work-from-home range,
 * approved by an ORG_ADMIN. State changes are atomic updates from the expected
 * status, as with leave.
 */
export interface IAttendanceRequest extends Document {
    organizationId: Types.ObjectId;
    employeeId: Types.ObjectId;
    kind: AttendanceRequestKind;
    /** YYYY-MM-DD; a regularization is a single date (start = end). */
    startDate: string;
    endDate: string;
    /** Regularization only: the corrected times, "HH:mm" in APP_TIMEZONE. */
    clockIn: string | null;
    clockOut: string | null;
    reason: string;
    status: AttendanceRequestStatus;
    decidedBy: Types.ObjectId | null;
    decidedAt: Date | null;
    decisionNote: string;
    isDeleted: boolean;
    deletedAt: Date | null;
    deletedBy: Types.ObjectId | null;
    createdBy: Types.ObjectId | null;
    updatedBy: Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}

const attendanceRequestSchema = new Schema<IAttendanceRequest>(
    {
        organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
        employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        kind: { type: String, enum: ATTENDANCE_REQUEST_KINDS, required: true },
        startDate: { type: String, required: true },
        endDate: { type: String, required: true },
        clockIn: { type: String, default: null },
        clockOut: { type: String, default: null },
        reason: { type: String, default: '', trim: true },
        status: { type: String, enum: ATTENDANCE_REQUEST_STATUSES, default: 'pending' },
        decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        decidedAt: { type: Date, default: null },
        decisionNote: { type: String, default: '' },
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
        deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true }
);

attendanceRequestSchema.index({ organizationId: 1, status: 1, kind: 1, createdAt: 1 });
attendanceRequestSchema.index({ organizationId: 1, employeeId: 1, kind: 1, startDate: 1 });
// One pending fix per person per date, even under concurrent submits.
attendanceRequestSchema.index(
    { organizationId: 1, employeeId: 1, startDate: 1 },
    { unique: true, partialFilterExpression: { kind: 'regularization', status: 'pending', isDeleted: false }, name: 'one_pending_fix_per_day' }
);

export const AttendanceRequestModel = model<IAttendanceRequest>('AttendanceRequest', attendanceRequestSchema);
