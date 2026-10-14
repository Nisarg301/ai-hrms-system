import { createSlice } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { AdminExpenseClaim, ExpenseCategory, ExpenseClaimDetail, ExpenseSummary } from '../../types/expense';
import {
  decideClaim,
  deleteCategory,
  fetchAdminClaims,
  fetchAllCategories,
  fetchExpensePendingCount,
  fetchExpenseSummary,
  openAdminClaim,
  saveCategory,
} from './expensesAdminThunks';

/** ORG_ADMIN: everyone's claims, the one under review, the badge count, spending and categories. */
export interface ExpensesAdminState {
  claims: AdminExpenseClaim[];
  claimsTotal: number;
  claimsStatus: ListStatus;
  claimsError: string | null;
  pendingCount: number | null;
  current: ExpenseClaimDetail | null;
  summary: ExpenseSummary | null;
  summaryStatus: ListStatus;
  summaryError: string | null;
  categories: ExpenseCategory[];
  categoriesStatus: ListStatus;
  categoriesError: string | null;
}

const initialState: ExpensesAdminState = {
  claims: [],
  claimsTotal: 0,
  claimsStatus: 'idle',
  claimsError: null,
  pendingCount: null,
  current: null,
  summary: null,
  summaryStatus: 'idle',
  summaryError: null,
  categories: [],
  categoriesStatus: 'idle',
  categoriesError: null,
};

const byName = (a: ExpenseCategory, b: ExpenseCategory) => a.name.localeCompare(b.name);

const expensesAdminSlice = createSlice({
  name: 'expensesAdmin',
  initialState,
  reducers: {
    closeAdminClaim(state) {
      state.current = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAdminClaims.pending, (state) => {
        state.claimsStatus = 'loading';
        state.claimsError = null;
      })
      .addCase(fetchAdminClaims.fulfilled, (state, action) => {
        state.claimsStatus = 'succeeded';
        state.claims = action.payload.items;
        state.claimsTotal = action.payload.meta.total;
      })
      .addCase(fetchAdminClaims.rejected, (state, action) => {
        state.claimsStatus = 'failed';
        state.claimsError = action.payload ?? 'Could not load claims';
      })
      .addCase(fetchExpensePendingCount.fulfilled, (state, action) => {
        state.pendingCount = action.payload;
      })
      .addCase(openAdminClaim.fulfilled, (state, action) => {
        state.current = action.payload;
      })
      .addCase(decideClaim.fulfilled, (state, action) => {
        state.current = action.payload;
        const { items: _items, ...claim } = action.payload;
        state.claims = state.claims.map((c) => (c.id === claim.id ? { ...c, ...claim } : c));
      })
      .addCase(fetchExpenseSummary.pending, (state) => {
        state.summaryStatus = 'loading';
        state.summaryError = null;
      })
      .addCase(fetchExpenseSummary.fulfilled, (state, action) => {
        state.summaryStatus = 'succeeded';
        state.summary = action.payload;
      })
      .addCase(fetchExpenseSummary.rejected, (state, action) => {
        state.summaryStatus = 'failed';
        state.summaryError = action.payload ?? 'Could not load the summary';
      })
      .addCase(fetchAllCategories.pending, (state) => {
        if (state.categoriesStatus === 'idle') state.categoriesStatus = 'loading';
        state.categoriesError = null;
      })
      .addCase(fetchAllCategories.fulfilled, (state, action) => {
        state.categoriesStatus = 'succeeded';
        state.categories = action.payload;
      })
      .addCase(fetchAllCategories.rejected, (state, action) => {
        state.categoriesStatus = 'failed';
        state.categoriesError = action.payload ?? 'Could not load categories';
      })
      .addCase(saveCategory.fulfilled, (state, action) => {
        const others = state.categories.filter((c) => c.id !== action.payload.id);
        state.categories = [...others, action.payload].sort(byName);
      })
      .addCase(deleteCategory.fulfilled, (state, action) => {
        state.categories = state.categories.filter((c) => c.id !== action.payload);
      });
  },
});

export const { closeAdminClaim } = expensesAdminSlice.actions;
export const expensesAdminReducer = expensesAdminSlice.reducer;
