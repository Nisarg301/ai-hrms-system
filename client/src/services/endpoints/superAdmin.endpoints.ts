import { callApiServices } from '../callApiServices';
import type { ListParams } from '../../types/api';
import type { AdminUserRow, InviteOrgAdminPayload, InviteResult, OrganizationRow } from '../../types/adminUser';

export function listAdminUsersRequest(params: ListParams) {
  return callApiServices<AdminUserRow[]>('/superadmin/admin-users', 'get', true, params);
}

export function inviteOrgAdminRequest(payload: InviteOrgAdminPayload) {
  return callApiServices<InviteResult>('/superadmin/invite-org-admin', 'post', true, payload);
}

export function disableAdminUserRequest(id: string) {
  return callApiServices<{ id: string; status: string }>(`/superadmin/admin-users/${id}/disable`, 'patch', true);
}

export function listOrganizationsRequest(params: ListParams) {
  return callApiServices<OrganizationRow[]>('/superadmin/organizations', 'get', true, params);
}
