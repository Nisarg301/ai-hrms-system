import type { UserStatus } from './auth';

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  organizationId: string | null;
  organizationName: string | null;
  status: UserStatus;
  createdAt: string;
}

export interface OrganizationRow {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface InviteOrgAdminPayload {
  name: string;
  email: string;
  organizationId?: string;
  organizationName?: string;
}

export interface InviteResult {
  user: { id: string; name: string; email: string; organizationId: string | null };
  temp_password: string;
}
