import { ModuleName, PLAN_MODULES, PlanType } from "./modules";

export const BILLING_CYCLES = ["monthly", "quarterly", "yearly"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const CYCLE_MONTHS: Record<BillingCycle, number> = { monthly: 1, quarterly: 3, yearly: 12 };

export const PLAN_CURRENCY = 'INR';

/** Days before expiry when the ORG_ADMIN banner and reminder email start. */
export const PLAN_REMINDER_DAYS = 7;

export interface PlanDefinition {
    type: PlanType;
    name: string;
    description: string;
    modules: readonly ModuleName[];
    /** Integer paise. The only place prices live: quarterly = 3x and yearly = 12x monthly. */
    prices: Record<BillingCycle, number>;
}

export const PLANS: Record<PlanType, PlanDefinition> = {
    basic: {
        type: 'basic',
        name: 'Basic',
        description: 'Employees, documents, departments, projects, tasks, dashboard, and roles & permissions.',
        modules: PLAN_MODULES.basic,
        prices: { monthly: 30000, quarterly: 90000, yearly: 360000 },
    },
    professional: {
        type: 'professional',
        name: 'Professional',
        description: 'Everything in Basic, plus CSV exports and audit logs.',
        modules: PLAN_MODULES.professional,
        prices: { monthly: 60000, quarterly: 180000, yearly: 720000 },
    },
};