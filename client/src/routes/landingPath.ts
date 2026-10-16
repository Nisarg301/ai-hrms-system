import { ROUTES } from '../constants/routes';
import type { AuthUser } from '../types/auth';

/**
 * Where a user lands after login or a password change.
 * - SUPER_ADMIN: Admin Users.
 * - ORG_ADMIN: Billing until the organization has an active plan (this is also
 *   what takes a newly invited admin from the password change to payment), then Home.
 * - ORG_USER: Home, which every member has whatever their role's permissions.
 *   (An ORG_USER without an active plan is signed out by PlanGate.)
 */
export function landingPath(user: AuthUser): string {
  switch (user.role) {
    case 'SUPER_ADMIN':
      return ROUTES.adminUsers;
    case 'ORG_ADMIN':
      return user.subscription?.active ? ROUTES.home : ROUTES.billing;
    case 'ORG_USER':
    default:
      return ROUTES.home;
  }
}
