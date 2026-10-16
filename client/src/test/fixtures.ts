import { PLAN_FEATURES, PLAN_MODULES } from '../constants/modules';
import type { AuthState } from '../store/auth/authSlice';
import type { AuthUser } from '../types/auth';
import type { PlanType, Subscription } from '../types/subscription';

const DAY = 24 * 60 * 60 * 1000;

/** An organization plan that's active for another `days` days. */
export function activeSubscription(planType: PlanType = 'professional', days = 30): Subscription {
  return {
    planType,
    billingCycle: 'monthly',
    expiryDate: new Date(Date.now() + days * DAY).toISOString(),
    active: true,
    modules: [...PLAN_MODULES[planType]],
    features: [...PLAN_FEATURES[planType]],
  };
}

/** An organization that has never bought a plan. */
export const NO_PLAN: Subscription = { planType: null, billingCycle: null, expiryDate: null, active: false, modules: [] };

/** A plan that ran out yesterday. */
export function expiredSubscription(planType: PlanType = 'professional'): Subscription {
  return { planType, billingCycle: 'monthly', expiryDate: new Date(Date.now() - DAY).toISOString(), active: false, modules: [] };
}

/** Signed in as Ivy Mehta (u1), an ORG_USER, on an active plan. */
export function memberAuth(planType: PlanType = 'professional', extra: Partial<AuthUser> = {}): AuthState {
  return {
    user: {
      id: 'u1',
      name: 'Ivy Mehta',
      email: 'ivy@acme.com',
      role: 'ORG_USER',
      organizationId: 'o1',
      roleId: null,
      mustChangePassword: false,
      permissions: { scope: 'none' },
      subscription: activeSubscription(planType),
      ...extra,
    },
    status: 'authenticated',
    bootstrapped: true,
    error: null,
    resetToken: null,
  };
}
