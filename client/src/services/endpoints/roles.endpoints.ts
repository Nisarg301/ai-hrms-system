import { callApiServices } from '../callApiServices';
import type { ListParams } from '../../types/api';
import type { PermissionEntry, Role } from '../../types/role';

export interface RolePayload {
  name: string;
  permissions: PermissionEntry[];
}

export function listRolesRequest(params: ListParams) {
  return callApiServices<Role[]>('/roles', 'get', true, params);
}

export function getRoleRequest(id: string) {
  return callApiServices<Role>(`/roles/${id}`, 'get', true);
}

export function createRoleRequest(payload: RolePayload) {
  return callApiServices<Role>('/roles', 'post', true, payload);
}

export function updateRoleRequest(id: string, payload: Partial<RolePayload>) {
  return callApiServices<Role>(`/roles/${id}`, 'put', true, payload);
}

export function deleteRoleRequest(id: string) {
  return callApiServices<{ id: string; deleted: boolean }>(`/roles/${id}`, 'delete', true);
}
