import { Schema, model, Document, Types } from 'mongoose';

export const NOTIFICATION_TYPES = [
  'leave_requested',
  'leave_decided',
  'leave_recorded',
  'attendance_requested',
  'attendance_decided',
  'attendance_recorded',
  'post_comment',
  'announcement',
  'praise',
  'expense_submitted',
  'expense_decided',
  'expense_paid',
  'lifecycle_started',
  'lifecycle_buddy',
  'lifecycle_assigned',
  'lifecycle_ready',
  'lifecycle_reminder',
  'review_launched',
  'review_assigned',
  'review_submitted',
  'review_released',
  'review_reminder',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Kept 90 days (spec default 14), then removed by MongoDB's TTL monitor. */
export const NOTIFICATION_RETENTION_DAYS = 90;

export interface INotification extends Document {
  organizationId: Types.ObjectId;
  /** The recipient. */
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  /** An app path to open, e.g. "/me/leave". */
  link: string;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    link: { type: String, default: '/home' },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// My bell: newest first, and the unread count.
notificationSchema.index({ userId: 1, organizationId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, organizationId: 1, readAt: 1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60, name: 'expire_after_90_days' });

export const NotificationModel = model<INotification>('Notification', notificationSchema);
