import { createSlice, isAnyOf, type PayloadAction } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { ExpenseCategory, ExpenseClaim, ExpenseClaimDetail } from '../../types/expense';
import {
  addItem,
  copyClaim,
  createClaim,
  deleteClaim,
  deleteItem,
  deleteReceipt,
  fetchExpenseCategories,
  fetchMyClaims,
  openClaim,
  renameClaim,
  submitClaim,
  updateItem,
  uploadReceipt,
  withdrawClaim,
} from './expensesThunks';

/** My expense claims, and the one open in the claim drawer. */
export interface ExpensesState {
  categories: ExpenseCategory[];
  claims: ExpenseClaim[];
  claimsStatus: ListStatus;
  claimsError: string | null;
  current: ExpenseClaimDetail | null;
}

const initialState: ExpensesState = { categories: [], claims: [], claimsStatus: 'idle', claimsError: null, current: null };

/** Keeps the list in step with a claim that just changed (newest first for a new one). */
function upsert(state: ExpensesState, detail: ExpenseClaimDetail) {
  const { items: _items, ...claim } = detail;
  const i = state.claims.findIndex((c) => c.id === claim.id);
  if (i >= 0) state.claims[i] = claim;
  else state.claims.unshift(claim);
}

const expensesSlice = createSlice({
  name: 'expenses',
  initialState,
  reducers: {
    closeClaim(state) {
      state.current = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchExpenseCategories.fulfilled, (state, action) => {
        state.categories = action.payload;
      })
      .addCase(fetchMyClaims.pending, (state) => {
        if (state.claimsStatus === 'idle') state.claimsStatus = 'loading';
        state.claimsError = null;
      })
      .addCase(fetchMyClaims.fulfilled, (state, action) => {
        state.claimsStatus = 'succeeded';
        state.claims = action.payload;
      })
      .addCase(fetchMyClaims.rejected, (state, action) => {
        state.claimsStatus = 'failed';
        state.claimsError = action.payload ?? 'Could not load your expenses';
      })
      .addCase(deleteClaim.fulfilled, (state, action: PayloadAction<string>) => {
        state.claims = state.claims.filter((c) => c.id !== action.payload);
        if (state.current?.id === action.payload) state.current = null;
      })
      .addMatcher(
        isAnyOf(
          openClaim.fulfilled,
          createClaim.fulfilled,
          renameClaim.fulfilled,
          addItem.fulfilled,
          updateItem.fulfilled,
          deleteItem.fulfilled,
          uploadReceipt.fulfilled,
          deleteReceipt.fulfilled,
          submitClaim.fulfilled,
          withdrawClaim.fulfilled,
          copyClaim.fulfilled
        ),
        (state, action: PayloadAction<ExpenseClaimDetail>) => {
          state.current = action.payload;
          upsert(state, action.payload);
        }
      );
  },
});

export const { closeClaim } = expensesSlice.actions;
export const expensesReducer = expensesSlice.reducer;
