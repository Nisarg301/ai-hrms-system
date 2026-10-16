import { callApiServices } from '../callApiServices';
import type {
  AdminClaimFilters,
  AdminExpenseClaim,
  CategoryPayload,
  ClaimStatus,
  ExpenseCategory,
  ExpenseClaim,
  ExpenseClaimDetail,
  ExpenseItemPayload,
  ExpenseSummary,
  PayPayload,
  PayResult,
} from '../../types/expense';

export function listExpenseCategoriesRequest(all = false) {
  return callApiServices<ExpenseCategory[]>('/expense-categories', 'get', true, all ? { all: 'true' } : undefined);
}

export function listMyClaimsRequest(status?: ClaimStatus) {
  return callApiServices<ExpenseClaim[]>('/expenses/mine', 'get', true, status ? { status } : undefined);
}

export function createClaimRequest(title: string) {
  return callApiServices<ExpenseClaimDetail>('/expenses', 'post', true, { title });
}

export function getClaimRequest(id: string) {
  return callApiServices<ExpenseClaimDetail>(`/expenses/${id}`, 'get', true);
}

export function renameClaimRequest(id: string, title: string) {
  return callApiServices<ExpenseClaimDetail>(`/expenses/${id}`, 'put', true, { title });
}

export function deleteClaimRequest(id: string) {
  return callApiServices<{ id: string; deleted: boolean }>(`/expenses/${id}`, 'delete', true);
}

export function addItemRequest(claimId: string, payload: ExpenseItemPayload) {
  return callApiServices<ExpenseClaimDetail>(`/expenses/${claimId}/items`, 'post', true, payload);
}

export function updateItemRequest(claimId: string, itemId: string, payload: Partial<ExpenseItemPayload>) {
  return callApiServices<ExpenseClaimDetail>(`/expenses/${claimId}/items/${itemId}`, 'put', true, payload);
}

export function deleteItemRequest(claimId: string, itemId: string) {
  return callApiServices<ExpenseClaimDetail>(`/expenses/${claimId}/items/${itemId}`, 'delete', true);
}

export function uploadReceiptRequest(claimId: string, itemId: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return callApiServices<ExpenseClaimDetail>(`/expenses/${claimId}/items/${itemId}/receipts`, 'post', true, form);
}

/** The receipt file itself (the API needs the login token, so it's fetched rather than linked). */
export function getReceiptRequest(claimId: string, itemId: string, fileId: string) {
  return callApiServices<Blob>(`/expenses/${claimId}/items/${itemId}/receipts/${fileId}`, 'get', true, undefined, 'blob');
}

export function deleteReceiptRequest(claimId: string, itemId: string, fileId: string) {
  return callApiServices<ExpenseClaimDetail>(`/expenses/${claimId}/items/${itemId}/receipts/${fileId}`, 'delete', true);
}

export function submitClaimRequest(id: string) {
  return callApiServices<ExpenseClaimDetail>(`/expenses/${id}/submit`, 'post', true);
}

export function withdrawClaimRequest(id: string) {
  return callApiServices<ExpenseClaimDetail>(`/expenses/${id}/withdraw`, 'post', true);
}

export function copyClaimRequest(id: string) {
  return callApiServices<ExpenseClaimDetail>(`/expenses/${id}/copy`, 'post', true);
}

// ---------------------------------------------------------------- ORG_ADMIN

export function listAdminClaimsRequest(filters: AdminClaimFilters & { page: number; limit: number }) {
  return callApiServices<AdminExpenseClaim[]>('/expenses', 'get', true, filters);
}

export function getExpensePendingCountRequest() {
  return callApiServices<{ count: number }>('/expenses/pending-count', 'get', true);
}

export function getExpenseSummaryRequest(range: { from: string; to: string }) {
  return callApiServices<ExpenseSummary>('/expenses/summary', 'get', true, range);
}

export function approveClaimRequest(id: string, note: string) {
  return callApiServices<ExpenseClaimDetail>(`/expenses/${id}/approve`, 'post', true, { note });
}

export function rejectClaimRequest(id: string, note: string) {
  return callApiServices<ExpenseClaimDetail>(`/expenses/${id}/reject`, 'post', true, { note });
}

export function payClaimsRequest(payload: PayPayload) {
  return callApiServices<PayResult>('/expenses/pay', 'post', true, payload);
}

export function createCategoryRequest(payload: CategoryPayload) {
  return callApiServices<ExpenseCategory>('/expense-categories', 'post', true, payload);
}

export function updateCategoryRequest(id: string, payload: Partial<CategoryPayload>) {
  return callApiServices<ExpenseCategory>(`/expense-categories/${id}`, 'put', true, payload);
}

export function deleteCategoryRequest(id: string) {
  return callApiServices<unknown>(`/expense-categories/${id}`, 'delete', true);
}

/** Professional: one CSV row per expense in the date range; the filename comes back in Content-Disposition. */
export function exportExpensesRequest(range: { from?: string; to?: string }) {
  return callApiServices<Blob>('/exports/expenses', 'get', true, range, 'blob');
}
