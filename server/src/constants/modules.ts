export const MODULES = ['dashboard', 'employees', 'documents', 'projects', 'tasks', 'departments', 'exports', 'auditLogs'] as const;
export type ModuleName = (typeof MODULES)[number];

export const PLAN_TYPES = ['basic', 'professional'] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

// Which permission-matrix modules each plan unlocks. Roles & Permissions is not a
// matrix module (it's the ORG_ADMIN-only /roles screen) and is on both plans.
// Keep in sync with frontend/src/constants/modules.ts.
export const PLAN_MODULES: Record<PlanType, readonly ModuleName[]> = {
    basic: ['dashboard', 'employees', 'documents', 'projects', 'tasks', 'departments'],
    professional: ['dashboard', 'employees', 'documents', 'projects', 'tasks', 'departments', 'exports', 'auditLogs'],
};

// Features that aren't permission-matrix modules: everyone in an organization that has
// one uses it (like Home and Me), so the plan alone decides. Checked by requirePlanFeature.
// Keep in sync with frontend/src/constants/modules.ts.
export const PLAN_FEATURES = {
    basic: ['expenses', 'onboarding'],
    professional: ['expenses', 'onboarding', 'performance'],
} as const satisfies Record<PlanType, readonly string[]>;
export type PlanFeature = (typeof PLAN_FEATURES)['professional'][number];
