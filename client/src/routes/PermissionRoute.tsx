import { Navigate, Outlet } from 'react-router-dom';
import { ROUTES } from '../constants/routes';
import { useAppSelector } from '../hooks/store';
import { selectPermissions, selectPlanModules } from '../store/auth/authSelectors';
import { can } from '../permissions/can';
import type { ModuleName } from '../types/role';

interface PermissionRouteProps {
  module: ModuleName;
}

/**
 * Gates a feature module's routes on the current user's `read` permission for
 * that module. UX only — the backend independently enforces every request.
 */
export function PermissionRoute({ module }: PermissionRouteProps) {
  const perms = useAppSelector(selectPermissions);
  const planModules = useAppSelector(selectPlanModules);

  if (!can(perms, module, 'read', planModules)) {
    return <Navigate to={ROUTES.unauthorized} replace />;
  }
  return <Outlet />;
}
