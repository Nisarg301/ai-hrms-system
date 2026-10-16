import { Schema, model, Document, Types } from 'mongoose';

export const PUNCH_SOURCES = ['web', 'regularization'] as const;
export type PunchSource = (typeof PUNCH_SOURCES)[number];

/** One clock-in → clock-out pair. A day can have several (breaks). */
export interface IAttendancePunch extends Document {
    organizationId: Types.ObjectId;
    employeeId: Types.ObjectId;
    /** YYYY-MM-DD in APP_TIMEZONE of the clock-in; the day this punch counts towards. */
    date: string;
    clockIn: Date;
    /** null while clocked in, or when the clock-out was forgotten. */
    clockOut: Date | null;
    /**
     * True only for the one punch the person is currently clocked in on. A forgotten
     * clock-out is set aside (false, clockOut still null) so the next clock-in works.
     */
    isOpen: boolean;
    source: PunchSource;
    isDeleted: boolean;
    deletedAt: Date | null;
    deletedBy: Types.ObjectId | null;
    createdBy: Types.ObjectId | null;
    updatedBy: Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}

const attendancePunchSchema = new Schema<IAttendancePunch>(
    {
        organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
        employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        date: { type: String, required: true },
        clockIn: { type: Date, required: true },
        clockOut: { type: Date, default: null },
        isOpen: { type: Boolean, default: false },
        source: { type: String, enum: PUNCH_SOURCES, default: 'web' },
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
        deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true }
);

attendancePunchSchema.index({ organizationId: 1, employeeId: 1, date: 1 });
attendancePunchSchema.index({ organizationId: 1, date: 1 });
// At most one live clock-in per person: a double-click on Clock In can't make two.
attendancePunchSchema.index(
    { organizationId: 1, employeeId: 1 },
    { unique: true, partialFilterExpression: { isOpen: true, isDeleted: false }, name: 'one_open_punch' }
);

export const AttendancePunchModel = model<IAttendancePunch>('AttendancePunch', attendancePunchSchema);
