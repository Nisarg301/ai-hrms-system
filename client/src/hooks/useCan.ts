import { useCallback } from 'react';
import { useAppSelector } from './store';
import { selectPermissions, selectPlanModules } from '../store/auth/authSelectors';
import { can } from '../permissions/can';
import type { ModuleName, PermissionAction } from '../types/role';

/** Returns a stable `can(module, action)` predicate for the current user. */
export function useCan(): (module: ModuleName, action: PermissionAction) => boolean {
  const perms = useAppSelector(selectPermissions);
  const planModules = useAppSelector(selectPlanModules);
  return useCallback(
    (module: ModuleName, action: PermissionAction) => can(perms, module, action, planModules),
    [perms, planModules]
  );
}
