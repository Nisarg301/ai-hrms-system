import { Schema, model, Document, Types } from 'mongoose';

/** One organization's work schedule (spec default 2). Times are "HH:mm" in APP_TIMEZONE. */
export interface IAttendanceSettings extends Document {
    organizationId: Types.ObjectId;
    shiftStart: string;
    shiftEnd: string;
    /** A first clock-in later than shiftStart + grace is marked late. */
    graceMinutes: number;
    fullDayMinutes: number;
    halfDayMinutes: number;
    updatedBy: Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}

export const DEFAULT_ATTENDANCE_SETTINGS = {
    shiftStart: '09:30',
    shiftEnd: '18:30',
    graceMinutes: 15,
    fullDayMinutes: 480,
    halfDayMinutes: 240,
};

const attendanceSettingsSchema = new Schema<IAttendanceSettings>(
    {
        organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
        shiftStart: { type: String, default: DEFAULT_ATTENDANCE_SETTINGS.shiftStart },
        shiftEnd: { type: String, default: DEFAULT_ATTENDANCE_SETTINGS.shiftEnd },
        graceMinutes: { type: Number, default: DEFAULT_ATTENDANCE_SETTINGS.graceMinutes },
        fullDayMinutes: { type: Number, default: DEFAULT_ATTENDANCE_SETTINGS.fullDayMinutes },
        halfDayMinutes: { type: Number, default: DEFAULT_ATTENDANCE_SETTINGS.halfDayMinutes },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true }
);

export const AttendanceSettingsModel = model<IAttendanceSettings>('AttendanceSettings', attendanceSettingsSchema);
