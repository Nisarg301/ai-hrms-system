import { callApiServices } from '../callApiServices';
import type { AdminLeaveRequestRow, LeaveRequestFilters, LeaveRequestRow, LeaveType, LeaveTypePayload, RecordLeavePayload } from '../../types/leave';

export function listLeaveRequestsRequest(params: LeaveRequestFilters & { page: number; limit: number }) {
  return callApiServices<AdminLeaveRequestRow[]>('/leave/requests', 'get', true, params);
}

export function getPendingCountRequest() {
  return callApiServices<{ count: number }>('/leave/pending-count', 'get', true);
}

export function approveLeaveRequest(id: string, note: string) {
  return callApiServices<LeaveRequestRow>(`/leave/requests/${id}/approve`, 'post', true, { note });
}

export function rejectLeaveRequest(id: string, note: string) {
  return callApiServices<LeaveRequestRow>(`/leave/requests/${id}/reject`, 'post', true, { note });
}

export function recordLeaveRequest(payload: RecordLeavePayload) {
  return callApiServices<LeaveRequestRow>('/leave/requests/record', 'post', true, payload);
}

export function listLeaveTypesRequest() {
  return callApiServices<LeaveType[]>('/leave-types', 'get', true, { all: 'true' });
}

export function createLeaveTypeRequest(payload: LeaveTypePayload) {
  return callApiServices<LeaveType>('/leave-types', 'post', true, payload);
}

export function updateLeaveTypeRequest(id: string, payload: Partial<LeaveTypePayload>) {
  return callApiServices<LeaveType>(`/leave-types/${id}`, 'put', true, payload);
}

export function deleteLeaveTypeRequest(id: string) {
  return callApiServices<{ id: string; deleted: boolean }>(`/leave-types/${id}`, 'delete', true);
}
