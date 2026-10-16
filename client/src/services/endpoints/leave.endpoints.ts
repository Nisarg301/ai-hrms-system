import { callApiServices } from '../callApiServices';
import type { ApplyLeavePayload, LeaveBalance, LeaveInput, LeavePreview, LeaveRequestRow } from '../../types/leave';

/** Mine, or (ORG_ADMIN) someone else's. */
export function getMyBalancesRequest(employeeId?: string) {
  return callApiServices<LeaveBalance[]>('/leave/balances', 'get', true, employeeId ? { employeeId } : undefined);
}

/** With employeeId (ORG_ADMIN), previews a recording for that employee. */
export function previewLeaveRequest(input: LeaveInput, employeeId?: string) {
  return callApiServices<LeavePreview>('/leave/preview', 'get', true, { ...input, halfDay: input.halfDay ?? '', ...(employeeId ? { employeeId } : {}) });
}

export function getMyLeaveRequestsRequest(year?: number) {
  return callApiServices<LeaveRequestRow[]>('/leave/requests/mine', 'get', true, year ? { year } : undefined);
}

export function applyLeaveRequest(payload: ApplyLeavePayload) {
  return callApiServices<LeaveRequestRow>('/leave/requests', 'post', true, payload);
}

export function cancelLeaveRequest(id: string) {
  return callApiServices<LeaveRequestRow>(`/leave/requests/${id}/cancel`, 'post', true);
}
