import { callApiServices } from '../callApiServices';
import type {
  AttendancePendingCounts,
  AttendanceRequestKind,
  AttendanceRequestPayload,
  AttendanceRequestRow,
  AttendanceRequestStatus,
  MonthView,
  RecordFixPayload,
  Schedule,
  TeamDay,
  TeamMonth,
  TodayView,
} from '../../types/attendance';

export function getTodayRequest() {
  return callApiServices<TodayView>('/attendance/today', 'get', true);
}

export function clockInRequest() {
  return callApiServices<TodayView>('/attendance/clock-in', 'post', true);
}

export function clockOutRequest() {
  return callApiServices<TodayView>('/attendance/clock-out', 'post', true);
}

export function getMyMonthRequest(month: string) {
  return callApiServices<MonthView>('/attendance/me', 'get', true, { month });
}

export function getScheduleRequest() {
  return callApiServices<Schedule>('/attendance/settings', 'get', true);
}

export function updateScheduleRequest(payload: Schedule) {
  return callApiServices<Schedule>('/attendance/settings', 'put', true, payload);
}

export function createAttendanceRequestRequest(payload: AttendanceRequestPayload) {
  return callApiServices<AttendanceRequestRow>('/attendance/requests', 'post', true, payload);
}

export function getMyAttendanceRequestsRequest() {
  return callApiServices<AttendanceRequestRow[]>('/attendance/requests/mine', 'get', true);
}

export function cancelAttendanceRequestRequest(id: string) {
  return callApiServices<AttendanceRequestRow>(`/attendance/requests/${id}/cancel`, 'post', true);
}

export function listAttendanceRequestsRequest(params: { kind: AttendanceRequestKind; status?: AttendanceRequestStatus; page: number; limit: number }) {
  return callApiServices<AttendanceRequestRow[]>('/attendance/requests', 'get', true, params);
}

export function getAttendancePendingCountRequest() {
  return callApiServices<AttendancePendingCounts>('/attendance/pending-count', 'get', true);
}

export function decideAttendanceRequestRequest(id: string, action: 'approve' | 'reject', note: string) {
  return callApiServices<AttendanceRequestRow>(`/attendance/requests/${id}/${action}`, 'post', true, { note });
}

export function recordFixRequest(payload: RecordFixPayload) {
  return callApiServices<AttendanceRequestRow>('/attendance/requests/record', 'post', true, payload);
}

export function getTeamDayRequest(params: { date?: string; departmentId?: string }) {
  return callApiServices<TeamDay>('/attendance/team', 'get', true, params);
}

export function getTeamMonthRequest(params: { month?: string; departmentId?: string }) {
  return callApiServices<TeamMonth>('/attendance/team/month', 'get', true, params);
}

/** Professional, ORG_ADMIN: the month as CSV; the filename comes back in Content-Disposition. */
export function exportAttendanceRequest(month: string) {
  return callApiServices<Blob>('/exports/attendance', 'get', true, { month }, 'blob');
}
