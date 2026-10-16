import type { HalfDay } from './leave';
import type { Person } from './people';

export interface Schedule {
  /** "HH:mm" in the organization's timezone. */
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
}

export type DayStatus =
  | 'present'
  | 'half_day'
  | 'absent'
  | 'on_leave'
  | 'holiday'
  | 'weekend'
  | 'worked_on_off_day'
  | 'in_progress'
  | 'not_in_yet'
  | 'missing_clock_out'
  | 'upcoming'
  /** Before the person's joining date. */
  | 'not_joined';

export interface DayView {
  /** YYYY-MM-DD */
  date: string;
  status: DayStatus;
  workedMinutes: number;
  /** ISO instants. */
  firstIn: string | null;
  lastOut: string | null;
  late: boolean;
  wfh: boolean;
  leave: { halfDay: HalfDay | null; typeName: string } | null;
  holidayName: string | null;
  missingClockOut: boolean;
}

export interface Punch {
  id: string;
  clockIn: string;
  clockOut: string | null;
  source: 'web' | 'regularization';
}

export interface TodayView {
  date: string;
  /** The server's clock when this was built. */
  now: string;
  schedule: Schedule;
  day: DayView;
  punches: Punch[];
  clockedIn: boolean;
  clockedInSince: string | null;
  canClockIn: boolean;
  cannotClockInReason: string | null;
  canClockOut: boolean;
}

export interface MonthTotals {
  present: number;
  halfDay: number;
  absent: number;
  late: number;
  onLeave: number;
  averageMinutes: number;
}

export interface MonthView {
  /** YYYY-MM */
  month: string;
  days: DayView[];
  totals: MonthTotals;
}

export type AttendanceRequestKind = 'regularization' | 'wfh';
export type AttendanceRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface AttendanceRequestRow {
  id: string;
  employeeId: string;
  employeeName: string | null;
  kind: AttendanceRequestKind;
  startDate: string;
  endDate: string;
  /** Fix only: "HH:mm". */
  clockIn: string | null;
  clockOut: string | null;
  reason: string;
  status: AttendanceRequestStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string;
  recordedByName: string | null;
  createdAt: string;
  canCancel: boolean;
}

export type AttendanceRequestPayload =
  | { kind: 'regularization'; date: string; clockIn: string; clockOut: string; reason: string }
  | { kind: 'wfh'; startDate: string; endDate: string; reason: string };

export interface RecordFixPayload {
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut: string;
  reason: string;
}

export interface AttendancePendingCounts {
  regularization: number;
  wfh: number;
  total: number;
}

export interface TeamDay {
  date: string;
  rows: { person: Person; day: DayView }[];
  counts: Partial<Record<DayStatus, number>>;
  late: number;
  wfh: number;
}

export interface TeamMonthCell {
  date: string;
  status: DayStatus;
  late: boolean;
  wfh: boolean;
  workedMinutes: number;
}

export interface TeamMonth {
  month: string;
  dates: string[];
  rows: { person: Person; days: TeamMonthCell[] }[];
}
