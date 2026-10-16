import type { PlanFeature } from '../constants/modules';
import type { ModuleName } from './role';
import type { PLAN_TYPES } from '../constants/modules';
import type { BILLING_CYCLES } from '../constants/plans';

export type PlanType = (typeof PLAN_TYPES)[number];
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** The organization's plan, as sent with the signed-in user by /auth/login and /auth/me. */
export interface Subscription {
  planType: PlanType | null;
  billingCycle: BillingCycle | null;
  /** ISO timestamp. */
  expiryDate: string | null;
  active: boolean;
  /** Modules the plan unlocks; empty while the plan is inactive. */
  modules: ModuleName[];
  /** Plan features (Expenses, Onboarding, Performance); empty while inactive. Older sessions may lack it. */
  features?: PlanFeature[];
}

export interface PlanDefinition {
  type: PlanType;
  name: string;
  description: string;
  modules: ModuleName[];
  /** Integer paise. */
  prices: Record<BillingCycle, number>;
  currency: 'INR';
}
