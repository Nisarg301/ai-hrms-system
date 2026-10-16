import { Navigate, Outlet } from 'react-router-dom';
import { ROUTES } from '../constants/routes';
import { useAppSelector } from '../hooks/store';
import { selectAuthUser } from '../store/auth/authSelectors';
import type { UserRoleName } from '../types/auth';

interface RoleRouteProps {
  allow: UserRoleName[];
}

/**
 * UX only — the backend independently enforces authorization. This just avoids
 * showing doors that lead to a 403.
 */
export function RoleRoute({ allow }: RoleRouteProps) {
  const user = useAppSelector(selectAuthUser);

  if (!user || !allow.includes(user.role)) {
    return <Navigate to={ROUTES.unauthorized} replace />;
  }

  return <Outlet />;
}
