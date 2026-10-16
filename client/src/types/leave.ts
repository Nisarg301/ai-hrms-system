export type HalfDay = 'first' | 'second';

/** One leave type's balance for the current year. */
export interface LeaveBalance {
  leaveTypeId: string;
  name: string;
  code: string;
  isPaid: boolean;
  allowHalfDay: boolean;
  /** null = unlimited */
  yearlyQuota: number | null;
  approved: number;
  pending: number;
  /** null = unlimited */
  available: number | null;
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequestRow {
  id: string;
  employeeId: string;
  employeeName: string | null;
  leaveTypeId: string;
  leaveTypeName: string | null;
  leaveTypeCode: string | null;
  isPaid: boolean | null;
  /** YYYY-MM-DD */
  startDate: string;
  endDate: string;
  halfDay: HalfDay | null;
  days: number;
  reason: string;
  status: LeaveStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string;
  /** Set when an ORG_ADMIN recorded this leave for the employee (approved straight away). */
  recordedByName: string | null;
  createdAt: string;
  canCancel: boolean;
}

export interface LeaveInput {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  halfDay: HalfDay | null;
}

export interface ApplyLeavePayload extends LeaveInput {
  reason: string;
}

/** ORG_ADMIN recording leave for someone. */
export interface RecordLeavePayload extends ApplyLeavePayload {
  employeeId: string;
}

export interface LeavePreview {
  days: number;
  /** null = unlimited */
  availableAfter: number | null;
}

/** A row on the ORG_ADMIN's approvals list. */
export interface AdminLeaveRequestRow extends LeaveRequestRow {
  /** For pending rows: what the employee would have left if approved (null = unlimited). */
  availableAfter: number | null;
}

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  isPaid: boolean;
  /** null = unlimited */
  yearlyQuota: number | null;
  allowHalfDay: boolean;
  isActive: boolean;
}

export type LeaveTypePayload = Omit<LeaveType, 'id'>;

export interface LeaveRequestFilters {
  status?: LeaveStatus;
  employeeId?: string;
  from?: string;
  to?: string;
}
