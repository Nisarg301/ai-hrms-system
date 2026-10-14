export const BILLING_CYCLES = ['monthly', 'quarterly', 'yearly'] as const;

export const BILLING_CYCLE_LABELS: Record<(typeof BILLING_CYCLES)[number], string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

/** Days before expiry when the ORG_ADMIN renewal banner appears (matches the backend reminder email). */
export const PLAN_REMINDER_DAYS = 7;

/** Same text the backend returns when it refuses an ORG_USER login. */
export const ORG_PLAN_EXPIRED_MESSAGE = "Your organization's plan has expired. Please contact your organization admin.";
