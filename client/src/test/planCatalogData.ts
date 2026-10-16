import type { PlanDefinition } from '../types/subscription';

/** Same shape and prices as GET /plans. */
export const PLANS: PlanDefinition[] = [
  {
    type: 'basic',
    name: 'Basic',
    description: 'Employees, documents, departments, projects, tasks, dashboard, and roles & permissions.',
    modules: ['dashboard', 'employees', 'documents', 'projects', 'tasks', 'departments'],
    prices: { monthly: 30000, quarterly: 90000, yearly: 360000 },
    currency: 'INR',
  },
  {
    type: 'professional',
    name: 'Professional',
    description: 'Everything in Basic, plus CSV exports and audit logs.',
    modules: ['dashboard', 'employees', 'documents', 'projects', 'tasks', 'departments', 'exports', 'auditLogs'],
    prices: { monthly: 60000, quarterly: 180000, yearly: 720000 },
    currency: 'INR',
  },
];
