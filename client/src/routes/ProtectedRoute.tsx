import { Navigate, Outlet } from 'react-router-dom';
import { FullPageLoader } from '../components/Loader/FullPageLoader';
import { ROUTES } from '../constants/routes';
import { useAppSelector } from '../hooks/store';
import { selectBootstrapped, selectIsAuthenticated } from '../store/auth/authSelectors';

export function ProtectedRoute() {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const bootstrapped = useAppSelector(selectBootstrapped);

  // Until the boot sequence settles we cannot know whether there is a session,
  // so show a loader rather than flashing the login screen at a logged-in user.
  if (!bootstrapped) {
    return <FullPageLoader />;
  }

  return isAuthenticated ? <Outlet /> : <Navigate to={ROUTES.login} replace />;
}
