import { callApiServices } from '../callApiServices';
import type { ListParams } from '../../types/api';
import type { DepartmentPayload, DepartmentRow } from '../../types/department';

export function listDepartmentsRequest(params: ListParams) {
    return callApiServices<DepartmentRow[]>('/departments', 'get', true, params);
}

export function createDepartmentRequest(payload: DepartmentPayload) {
    return callApiServices<DepartmentRow>('/departments', 'post', true, payload);
}

export function updateDepartmentRequest(id: string, payload: Partial<DepartmentPayload>) {
    return callApiServices<DepartmentRow>(`/departments/${id}`, 'put', true, payload);
}

export function deleteDepartmentRequest(id: string) {
    return callApiServices<{ id: string; deleted: boolean }>(`/departments/${id}`, 'delete', true);
}
