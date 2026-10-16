import type { ClaimStatus, ExpenseClaim } from '../types/expense';

export const CLAIM_STATUS_META: Record<ClaimStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'default' },
  submitted: { label: 'Awaiting approval', color: 'gold' },
  approved: { label: 'Approved – to be paid', color: 'blue' },
  rejected: { label: 'Rejected', color: 'red' },
  paid: { label: 'Paid', color: 'green' },
};

/** How far back an expense can be (the server's rule). */
export const MAX_EXPENSE_AGE_DAYS = 90;

/** Rupees typed in a form → integer paise, without float drift (12.34 → 1234). */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export interface ClaimsSummary {
  drafts: number;
  awaiting: { count: number; totalPaise: number };
  toBePaid: { count: number; totalPaise: number };
  paidThisYearPaise: number;
}

/** The Me → Expenses chips and the Home card, from my claims. `year` is YYYY. */
export function summarizeClaims(claims: Pick<ExpenseClaim, 'status' | 'totalPaise' | 'paidOn'>[], year: string): ClaimsSummary {
  const summary: ClaimsSummary = { drafts: 0, awaiting: { count: 0, totalPaise: 0 }, toBePaid: { count: 0, totalPaise: 0 }, paidThisYearPaise: 0 };
  for (const c of claims) {
    if (c.status === 'draft') summary.drafts += 1;
    else if (c.status === 'submitted') {
      summary.awaiting.count += 1;
      summary.awaiting.totalPaise += c.totalPaise;
    } else if (c.status === 'approved') {
      summary.toBePaid.count += 1;
      summary.toBePaid.totalPaise += c.totalPaise;
    } else if (c.status === 'paid' && c.paidOn?.startsWith(year)) summary.paidThisYearPaise += c.totalPaise;
  }
  return summary;
}
