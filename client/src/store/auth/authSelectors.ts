import type { RootState } from '../index';
import type { EffectivePermissions } from '../../types/auth';

// A stable constant so the selector returns a referentially-stable value when
// there is no user (avoids the unmemoized-selector warning).
const NO_PERMISSIONS: EffectivePermissions = { scope: 'none' };

export const selectAuthUser = (state: RootState) => state.auth.user;
export const selectIsAuthenticated = (state: RootState) => state.auth.status === 'authenticated';
export const selectAuthStatus = (state: RootState) => state.auth.status;
export const selectBootstrapped = (state: RootState) => state.auth.bootstrapped;
export const selectAuthError = (state: RootState) => state.auth.error;
export const selectResetToken = (state: RootState) => state.auth.resetToken;
export const selectMustChangePassword = (state: RootState) => state.auth.user?.mustChangePassword ?? false;
/** undefined = no plan restriction (e.g. SUPER_ADMIN). */
export const selectPlanModules = (state: RootState) => state.auth.user?.subscription?.modules;
export const selectSubscription = (state: RootState) => state.auth.user?.subscription;
export const selectPermissions = (state: RootState): EffectivePermissions =>
  state.auth.user?.permissions ?? NO_PERMISSIONS;
