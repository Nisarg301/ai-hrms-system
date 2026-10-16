import type { AuthState } from '../store/auth/authSlice';
import type { ExpenseCategory, ExpenseClaimDetail, ExpenseItem } from '../types/expense';
import { activeSubscription } from './fixtures';

export const CATEGORIES: ExpenseCategory[] = [
  { id: 'c1', name: 'Travel', limitPaise: null, receiptRequiredAbovePaise: 50000, isActive: true },
  { id: 'c2', name: 'Food & meals', limitPaise: 100000, receiptRequiredAbovePaise: 50000, isActive: true },
];

export function claim(id: string, extra: Partial<ExpenseClaimDetail> = {}): ExpenseClaimDetail {
  return {
    id,
    number: null,
    title: `Claim ${id}`,
    status: 'draft',
    totalPaise: 0,
    itemCount: 0,
    employeeId: 'u1',
    employeeName: 'Ivy Mehta',
    submittedAt: null,
    decidedByName: null,
    decidedAt: null,
    decisionNote: '',
    paidByName: null,
    paidAt: null,
    paidOn: null,
    paymentReference: '',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    items: [],
    ...extra,
  };
}

export function item(id: string, extra: Partial<ExpenseItem> = {}): ExpenseItem {
  return {
    id,
    date: '2026-10-01',
    categoryId: 'c1',
    categoryName: 'Travel',
    amountPaise: 10000,
    merchant: `Merchant ${id}`,
    note: '',
    receipts: [],
    overLimit: false,
    receiptRequired: false,
    missingReceipt: false,
    ...extra,
  };
}

/** The server's derived fields: flags per item, the total and count per claim. */
export function recompute(c: ExpenseClaimDetail): ExpenseClaimDetail {
  c.items = c.items.map((i) => {
    const cat = CATEGORIES.find((x) => x.id === i.categoryId)!;
    const receiptRequired = i.amountPaise > cat.receiptRequiredAbovePaise;
    return {
      ...i,
      categoryName: cat.name,
      overLimit: cat.limitPaise !== null && i.amountPaise > cat.limitPaise,
      receiptRequired,
      missingReceipt: receiptRequired && i.receipts.length === 0,
    };
  });
  c.totalPaise = c.items.reduce((sum, i) => sum + i.amountPaise, 0);
  c.itemCount = c.items.length;
  return c;
}

/** A list row: the claim without its items. */
export function listView({ items: _items, ...c }: ExpenseClaimDetail) {
  return c;
}

export function adminAuth(plan: 'basic' | 'professional' = 'professional'): AuthState {
  return {
    user: {
      id: 'a1',
      name: 'Ann Admin',
      email: 'ann@x.com',
      role: 'ORG_ADMIN',
      organizationId: 'o1',
      roleId: null,
      mustChangePassword: false,
      permissions: { scope: 'all' },
      subscription: activeSubscription(plan),
    },
    status: 'authenticated',
    bootstrapped: true,
    error: null,
    resetToken: null,
  };
}
