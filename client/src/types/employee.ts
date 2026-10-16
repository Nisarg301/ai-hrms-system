import type { LifecycleKind } from './lifecycle';

export type EmployeeStatus = 'active' | 'disabled';

export interface EmployeeRow {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
  /** Department id; departmentName is resolved by the API for display. */
  department: string | null;
  departmentName: string | null;
  roleId: string | null;
  roleName: string | null;
  status: EmployeeStatus;
  /** Manager's user id, or null. */
  reportsTo: string | null;
  reportsToName: string | null;
  /** YYYY-MM-DD: set by an admin, else the day the account was created. */
  joiningDate: string;
  /** YYYY-MM-DD; only an ORG_ADMIN receives it (null otherwise). */
  dateOfBirth: string | null;
  /** A running onboarding or offboarding (anchorDate: joining date or last working day). */
  lifecycle?: { kind: LifecycleKind; anchorDate: string } | null;
}

export interface EmployeePayload {
  name: string;
  email: string;
  jobTitle: string;
  department: string;
  roleId: string;
  reportsTo?: string | null;
  joiningDate?: string;
  dateOfBirth?: string;
  /** Start onboarding with the new employee: all or nothing. */
  onboarding?: { templateId: string; buddyId?: string | null };
}

export interface EmployeeUpdatePayload {
  name?: string;
  email?: string;
  jobTitle?: string;
  department?: string;
  roleId?: string;
  status?: EmployeeStatus;
  /** null clears the manager. */
  reportsTo?: string | null;
  joiningDate?: string;
  /** null clears it. */
  dateOfBirth?: string | null;
}

export interface EmployeeCreateResult {
  user: EmployeeRow;
  temp_password: string;
}
