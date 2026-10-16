import type { ModuleName } from './role';
import type { UserRoleName } from './auth';

export const AUDIT_ACTIONS = ['create', 'update', 'delete', 'login', 'logout'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Roles aren't a permission-matrix module, but role changes are audited too. */
export type AuditModule = ModuleName | 'roles' | 'holidays' | 'announcements' | 'leave' | 'posts' | 'attendance' | 'expenses' | 'onboarding' | 'performance';

export interface AuditLogRow {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: UserRoleName;
  action: AuditAction;
  /** null for login/logout. */
  module: AuditModule | null;
  recordId: string | null;
  recordLabel: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditLogFilters {
  module?: AuditModule;
  action?: AuditAction;
  /** ISO timestamps. */
  from?: string;
  to?: string;
}
