import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { FullPageLoader } from '../components/Loader/FullPageLoader';
import { ROUTES } from '../constants/routes';
import { useAppDispatch, useAppSelector } from '../hooks/store';
import { selectAuthUser } from '../store/auth/authSelectors';
import { planExpiredSignOut } from '../store/auth/authThunks';

/**
 * UX mirror of the backend's requireActivePlan. An ORG_ADMIN without an active
 * plan is sent to Billing to pay; an ORG_USER is signed out and sees the
 * "contact your organization admin" message on the login page. SUPER_ADMIN is
 * never gated.
 */
export function PlanGate() {
  const user = useAppSelector(selectAuthUser);
  const dispatch = useAppDispatch();
  const blockedOrgUser = user?.role === 'ORG_USER' && !user.subscription?.active;

  useEffect(() => {
    if (blockedOrgUser) void dispatch(planExpiredSignOut());
  }, [blockedOrgUser, dispatch]);

  if (!user) return null;
  if (user.role === 'ORG_ADMIN' && !user.subscription?.active) {
    return <Navigate to={ROUTES.billing} replace />;
  }
  if (blockedOrgUser) return <FullPageLoader />;
  return <Outlet />;
}
