import type { EffectivePermissions } from '../types/auth';
import type { ModuleName, PermissionAction } from '../types/role';

/**
 * Mirrors the backend's authorize(): the organization's plan first, then the
 * hasPermission() read-gate (create/update/delete count only when read is also
 * true). UX only — the backend is the authority.
 *
 * `planModules` undefined means "no plan restriction" (SUPER_ADMIN, or a user
 * object without subscription data).
 */
export function can(
  perms: EffectivePermissions | undefined,
  module: ModuleName,
  action: PermissionAction,
  planModules?: readonly ModuleName[]
): boolean {
  // A module outside the plan doesn't exist, even for an ORG_ADMIN.
  if (planModules && !planModules.includes(module)) {
    return false;
  }
  if (!perms || perms.scope === 'none') {
    return false;
  }
  if (perms.scope === 'all') {
    return true;
  }
  const entry = perms.entries.find((e) => e.module === module);
  if (!entry) {
    return false;
  }
  if (action !== 'read' && !entry.read) {
    return false;
  }
  return entry[action];
}
