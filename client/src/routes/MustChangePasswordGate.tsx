import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ROUTES } from '../constants/routes';
import { useAppSelector } from '../hooks/store';
import { selectMustChangePassword } from '../store/auth/authSelectors';

/**
 * Invite-created accounts must change their temporary password before doing
 * anything else. This makes that flow mandatory rather than optional.
 */
export function MustChangePasswordGate() {
  const mustChange = useAppSelector(selectMustChangePassword);
  const location = useLocation();

  if (mustChange && location.pathname !== ROUTES.changePassword) {
    return <Navigate to={ROUTES.changePassword} replace />;
  }

  return <Outlet />;
}
