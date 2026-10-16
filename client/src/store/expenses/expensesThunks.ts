import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  addItemRequest,
  copyClaimRequest,
  createClaimRequest,
  deleteClaimRequest,
  deleteItemRequest,
  deleteReceiptRequest,
  getClaimRequest,
  listExpenseCategoriesRequest,
  listMyClaimsRequest,
  renameClaimRequest,
  submitClaimRequest,
  updateItemRequest,
  uploadReceiptRequest,
  withdrawClaimRequest,
} from '../../services/endpoints/expenses.endpoints';
import type { ExpenseCategory, ExpenseClaim, ExpenseClaimDetail, ExpenseItemPayload } from '../../types/expense';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';

export const fetchExpenseCategories = createAsyncThunk<ExpenseCategory[], void, { rejectValue: string }>(
  'expenses/fetchCategories',
  async (_, { rejectWithValue }) => {
    try {
      return (await listExpenseCategoriesRequest()).data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const fetchMyClaims = createAsyncThunk<ExpenseClaim[], void, { rejectValue: string }>('expenses/fetchMine', async (_, { rejectWithValue }) => {
  try {
    return (await listMyClaimsRequest()).data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** Every claim-changing call returns the claim with its items; the slice keeps it open. */
function claimThunk<Arg>(type: string, call: (arg: Arg) => Promise<{ data: ExpenseClaimDetail }>) {
  return createAsyncThunk<ExpenseClaimDetail, Arg, { rejectValue: FieldAwareError }>(type, async (arg, { rejectWithValue }) => {
    try {
      return (await call(arg)).data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  });
}

export const openClaim = claimThunk('expenses/open', (id: string) => getClaimRequest(id));
export const createClaim = claimThunk('expenses/create', (title: string) => createClaimRequest(title));
export const renameClaim = claimThunk('expenses/rename', ({ id, title }: { id: string; title: string }) => renameClaimRequest(id, title));
export const addItem = claimThunk('expenses/addItem', ({ claimId, payload }: { claimId: string; payload: ExpenseItemPayload }) =>
  addItemRequest(claimId, payload)
);
export const updateItem = claimThunk(
  'expenses/updateItem',
  ({ claimId, itemId, payload }: { claimId: string; itemId: string; payload: Partial<ExpenseItemPayload> }) => updateItemRequest(claimId, itemId, payload)
);
export const deleteItem = claimThunk('expenses/deleteItem', ({ claimId, itemId }: { claimId: string; itemId: string }) =>
  deleteItemRequest(claimId, itemId)
);
export const uploadReceipt = claimThunk('expenses/uploadReceipt', ({ claimId, itemId, file }: { claimId: string; itemId: string; file: File }) =>
  uploadReceiptRequest(claimId, itemId, file)
);
export const deleteReceipt = claimThunk(
  'expenses/deleteReceipt',
  ({ claimId, itemId, fileId }: { claimId: string; itemId: string; fileId: string }) => deleteReceiptRequest(claimId, itemId, fileId)
);
export const submitClaim = claimThunk('expenses/submit', (id: string) => submitClaimRequest(id));
export const withdrawClaim = claimThunk('expenses/withdraw', (id: string) => withdrawClaimRequest(id));
export const copyClaim = claimThunk('expenses/copy', (id: string) => copyClaimRequest(id));

export const deleteClaim = createAsyncThunk<string, string, { rejectValue: string }>('expenses/delete', async (id, { rejectWithValue }) => {
  try {
    await deleteClaimRequest(id);
    return id;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});
