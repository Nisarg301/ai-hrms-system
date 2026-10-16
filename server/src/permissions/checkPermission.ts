import { ModuleName } from '../constants/modules';
import { IRole } from '../models/role.model';
import { AuthenticatedUser } from '../types/express';

export type PermissionAction = 'read' | 'create' | 'update' | 'delete';

export function hasPermission(user: AuthenticatedUser, role: IRole | null, module: ModuleName, action: PermissionAction): boolean {
  if (user.role === 'ORG_ADMIN') {
    return true;
  }
  if (user.role !== 'ORG_USER' || !role) {
    return false;
  }
  const permission = role.permissions.find((p) => p.module === module);
  if (!permission) {
    return false;
  }
  if (action !== 'read' && !permission.read) {
    return false;
  }
  return Boolean(permission[action]);
}
