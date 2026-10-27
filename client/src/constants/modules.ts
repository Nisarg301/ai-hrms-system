// Mirrors backend/src/constants/modules.ts. Keep the two in sync.
export const MODULES = ['dashboard', 'employees', 'documents', 'projects', 'tasks', 'departments', 'exports', 'auditLogs'] as const;

export const MODULE_LABELS: Record<(typeof MODULES)[number], string> = {
  dashboard: 'Dashboard',
  employees: 'Employees',
  documents: 'Documents',
  projects: 'Projects',
  tasks: 'Tasks',
  departments: 'Departments',
  exports: 'Exports',
  auditLogs: 'Audit Logs',
};

export const PLAN_TYPES = ['basic', 'professional'] as const;

export const PLAN_NAMES: Record<(typeof PLAN_TYPES)[number], string> = {
  basic: 'Basic',
  professional: 'Professional',
};

// Which permission-matrix modules each plan unlocks. Roles & Permissions is not a
// matrix module (it's the ORG_ADMIN-only /roles screen) and is on both plans.
export const PLAN_MODULES: Record<(typeof PLAN_TYPES)[number], readonly (typeof MODULES)[number][]> = {
  basic: ['dashboard', 'employees', 'documents', 'projects', 'tasks', 'departments'],
  professional: ['dashboard', 'employees', 'documents', 'projects', 'tasks', 'departments', 'exports', 'auditLogs'],
};

// Features that aren't permission-matrix modules: everyone in an organization that has one
// uses it (like Home and Me), so the plan alone decides. Mirrors backend PLAN_FEATURES.
export const PLAN_FEATURES = {
  basic: ['expenses', 'onboarding'],
  professional: ['expenses', 'onboarding', 'performance', 'ai'],
} as const satisfies Record<(typeof PLAN_TYPES)[number], readonly string[]>;
export type PlanFeature = (typeof PLAN_FEATURES)['professional'][number];
