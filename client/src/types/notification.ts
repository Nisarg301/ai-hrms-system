export type NotificationType =
  | 'leave_requested'
  | 'leave_decided'
  | 'leave_recorded'
  | 'attendance_requested'
  | 'attendance_decided'
  | 'attendance_recorded'
  | 'post_comment'
  | 'announcement'
  | 'praise'
  | 'expense_submitted'
  | 'expense_decided'
  | 'expense_paid'
  | 'lifecycle_started'
  | 'lifecycle_buddy'
  | 'lifecycle_assigned'
  | 'lifecycle_ready'
  | 'lifecycle_reminder'
  | 'review_launched'
  | 'review_assigned'
  | 'review_submitted'
  | 'review_released'
  | 'review_reminder';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** An app path to open, e.g. "/me/leave". */
  link: string;
  read: boolean;
  createdAt: string;
}
