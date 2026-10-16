import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  approveClaimRequest,
  createCategoryRequest,
  deleteCategoryRequest,
  getClaimRequest,
  getExpensePendingCountRequest,
  getExpenseSummaryRequest,
  listAdminClaimsRequest,
  listExpenseCategoriesRequest,
  payClaimsRequest,
  rejectClaimRequest,
  updateCategoryRequest,
} from '../../services/endpoints/expenses.endpoints';
import { toPaginationMeta, type PaginationMeta } from '../../types/api';
import type {
  AdminClaimFilters,
  AdminExpenseClaim,
  CategoryPayload,
  ExpenseCategory,
  ExpenseClaimDetail,
  ExpenseSummary,
  PayPayload,
  PayResult,
} from '../../types/expense';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';

export const fetchAdminClaims = createAsyncThunk<
  { items: AdminExpenseClaim[]; meta: PaginationMeta },
  { filters: AdminClaimFilters; page?: number; limit?: number },
  { rejectValue: string }
>('expensesAdmin/fetchClaims', async ({ filters, page = 1, limit = 20 }, { rejectWithValue }) => {
  try {
    const { data, meta } = await listAdminClaimsRequest({ ...filters, page, limit });
    return { items: data, meta: toPaginationMeta(meta, { page, limit, total: data.length }) };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchExpensePendingCount = createAsyncThunk<number, void, { rejectValue: string }>(
  'expensesAdmin/fetchPendingCount',
  async (_, { rejectWithValue }) => {
    try {
      return (await getExpensePendingCountRequest()).data.count;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const openAdminClaim = createAsyncThunk<ExpenseClaimDetail, string, { rejectValue: string }>(
  'expensesAdmin/openClaim',
  async (id, { rejectWithValue }) => {
    try {
      return (await getClaimRequest(id)).data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/** Approve or reject (a note is required to reject). A stale claim comes back 409 "This claim is already …". */
export const decideClaim = createAsyncThunk<
  ExpenseClaimDetail,
  { id: string; action: 'approve' | 'reject'; note: string },
  { rejectValue: FieldAwareError }
>('expensesAdmin/decide', async ({ id, action, note }, { rejectWithValue }) => {
  try {
    return (await (action === 'approve' ? approveClaimRequest(id, note) : rejectClaimRequest(id, note))).data;
  } catch (err) {
    return rejectWithValue(toFieldAwareError(err));
  }
});

export const payClaims = createAsyncThunk<PayResult, PayPayload, { rejectValue: FieldAwareError }>(
  'expensesAdmin/pay',
  async (payload, { rejectWithValue }) => {
    try {
      return (await payClaimsRequest(payload)).data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const fetchExpenseSummary = createAsyncThunk<ExpenseSummary, { from: string; to: string }, { rejectValue: string }>(
  'expensesAdmin/fetchSummary',
  async (range, { rejectWithValue }) => {
    try {
      return (await getExpenseSummaryRequest(range)).data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/** Every category, inactive ones too. */
export const fetchAllCategories = createAsyncThunk<ExpenseCategory[], void, { rejectValue: string }>(
  'expensesAdmin/fetchCategories',
  async (_, { rejectWithValue }) => {
    try {
      return (await listExpenseCategoriesRequest(true)).data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const saveCategory = createAsyncThunk<
  ExpenseCategory,
  { id: string | null; payload: Partial<CategoryPayload> },
  { rejectValue: FieldAwareError }
>('expensesAdmin/saveCategory', async ({ id, payload }, { rejectWithValue }) => {
  try {
    return (await (id ? updateCategoryRequest(id, payload) : createCategoryRequest(payload as CategoryPayload))).data;
  } catch (err) {
    return rejectWithValue(toFieldAwareError(err));
  }
});

/** Refused once an expense uses the category ("Deactivate it instead"). */
export const deleteCategory = createAsyncThunk<string, string, { rejectValue: string }>(
  'expensesAdmin/deleteCategory',
  async (id, { rejectWithValue }) => {
    try {
      await deleteCategoryRequest(id);
      return id;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);
