export type ClaimStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';

export interface ExpenseCategory {
  id: string;
  name: string;
  /** Per-expense limit in paise; null = none. Over it is allowed, but flagged. */
  limitPaise: number | null;
  /** A receipt is needed above this (paise); 0 = always. */
  receiptRequiredAbovePaise: number;
  isActive: boolean;
}

export interface Receipt {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface ExpenseItem {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  categoryId: string;
  categoryName: string | null;
  amountPaise: number;
  merchant: string;
  note: string;
  receipts: Receipt[];
  overLimit: boolean;
  receiptRequired: boolean;
  missingReceipt: boolean;
}

export interface ExpenseClaim {
  id: string;
  /** EXP-2026-0042 once submitted; null for a never-submitted draft. */
  number: string | null;
  title: string;
  status: ClaimStatus;
  totalPaise: number;
  itemCount: number;
  employeeId: string;
  employeeName: string | null;
  submittedAt: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string;
  paidByName: string | null;
  paidAt: string | null;
  /** YYYY-MM-DD */
  paidOn: string | null;
  paymentReference: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseClaimDetail extends ExpenseClaim {
  items: ExpenseItem[];
}

export interface ExpenseItemPayload {
  date: string;
  categoryId: string;
  amountPaise: number;
  merchant: string;
  note: string;
}

/** A refused submit lists each expense that needs attention. */
export interface SubmitProblem {
  itemId: string;
  merchant: string;
  message: string;
}

/** ORG_ADMIN's list row: how many of the claim's expenses are over their category limit. */
export interface AdminExpenseClaim extends ExpenseClaim {
  overLimitCount: number;
}

/** ORG_ADMIN's claim filters; `from`/`to` are expense dates (YYYY-MM-DD). */
export interface AdminClaimFilters {
  status?: Exclude<ClaimStatus, 'draft'>;
  employeeId?: string;
  categoryId?: string;
  from?: string;
  to?: string;
}

export interface SpendRow {
  name: string;
  totalPaise: number;
  /** Number of expenses. */
  count: number;
}

/** Approved and paid spending by expense date; `awaiting…` are right now, whatever the dates. */
export interface ExpenseSummary {
  from: string;
  to: string;
  approvedPaise: number;
  paidPaise: number;
  byCategory: (SpendRow & { categoryId: string })[];
  byDepartment: (SpendRow & { departmentId: string | null })[];
  awaitingApproval: { count: number; totalPaise: number };
  awaitingPayment: { count: number; totalPaise: number };
}

export interface PayPayload {
  claimIds: string[];
  /** YYYY-MM-DD, not in the future. */
  paidOn: string;
  reference: string;
}

export interface PayResult {
  paid: ExpenseClaim[];
  /** Claims no longer approved (someone else paid them, say), with why. */
  skipped: { id: string; number: string | null; reason: string }[];
  totalPaidPaise: number;
}

export interface CategoryPayload {
  name: string;
  limitPaise: number | null;
  receiptRequiredAbovePaise: number;
  isActive: boolean;
}
