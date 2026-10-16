import { callApiServices } from '../callApiServices';
import type { ListParams } from '../../types/api';
import type { EmployeeCreateResult, EmployeePayload, EmployeeRow, EmployeeUpdatePayload } from '../../types/employee';

export function listEmployeesRequest(params: ListParams) {
  return callApiServices<EmployeeRow[]>('/employees', 'get', true, params);
}

export function createEmployeeRequest(payload: EmployeePayload) {
  return callApiServices<EmployeeCreateResult>('/employees', 'post', true, payload);
}

export function updateEmployeeRequest(id: string, payload: EmployeeUpdatePayload) {
  return callApiServices<EmployeeRow>(`/employees/${id}`, 'put', true, payload);
}

export function deleteEmployeeRequest(id: string) {
  return callApiServices<{ id: string; deleted: boolean }>(`/employees/${id}`, 'delete', true);
}
