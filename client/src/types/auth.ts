import type { PermissionEntry } from './role';
import type { Subscription } from './subscription';

export type UserRoleName = 'SUPER_ADMIN' | 'ORG_ADMIN' | 'ORG_USER';
export type UserStatus = 'active' | 'disabled';

export type EffectivePermissions =
  | { scope: 'all' }
  | { scope: 'none' }
  | { scope: 'matrix'; entries: PermissionEntry[] };

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRoleName;
  organizationId: string | null;
  /** The company's name, shown in the header; null for SUPER_ADMIN. Optional for older fixtures. */
  organizationName?: string | null;
  roleId: string | null;
  mustChangePassword: boolean;
  permissions: EffectivePermissions;
  /**
   * The organization's plan; null for SUPER_ADMIN. Optional only so older test
   * fixtures stay valid: the API always sends it.
   */
  subscription?: Subscription | null;
  avatar?: {
    url: string;
    id: string;
    originalName: string;
    mimeType: string;
    size: number;
  } | null;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export interface MeResponse {
  user: AuthUser;
}

export interface RefreshResponse {
  accessToken: string;
}
