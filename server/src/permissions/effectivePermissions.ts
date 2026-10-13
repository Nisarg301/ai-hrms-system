import { IUser } from '../models/user.model';
import { IRolePermission } from '../models/role.model';
import { roleRepository } from '../repositories/role.repository';

export type EffectivePermissions =
  | { scope: 'all' }
  | { scope: 'none' }
  | { scope: 'matrix'; entries: IRolePermission[] };

/**
 * The current user's effective permissions, mirroring hasPermission()'s roles:
 * ORG_ADMIN has full access, SUPER_ADMIN has none (no org modules), and an
 * ORG_USER carries its role's matrix (empty if it has no role).
 */
export async function resolveEffectivePermissions(user: IUser): Promise<EffectivePermissions> {
  if (user.role === 'ORG_ADMIN') {
    return { scope: 'all' };
  }
  if (user.role !== 'ORG_USER') {
    return { scope: 'none' };
  }
  const role = user.roleId ? await roleRepository.findById(user.roleId.toString()) : null;
  const entries: IRolePermission[] = role
    ? role.permissions.map((p) => ({
      module: p.module,
      read: p.read,
      create: p.create,
      update: p.update,
      delete: p.delete,
    }))
    : [];
  return { scope: 'matrix', entries };
}
