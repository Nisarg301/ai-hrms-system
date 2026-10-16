import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  createDepartmentRequest,
  deleteDepartmentRequest,
  listDepartmentsRequest,
  updateDepartmentRequest,
} from '../../services/endpoints/departments.endpoint';
import { toPaginationMeta, type PaginationMeta } from '../../types/api';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';
import type { DepartmentCreateResult, DepartmentPayload, DepartmentRow, DepartmentUpdatePayload } from '../../types/department';
import type { RootState } from '../index';

export const fetchDepartments = createAsyncThunk<
  { items: DepartmentRow[]; meta: PaginationMeta },
  void,
  { state: RootState; rejectValue: string }
>('departments/fetch', async (_, { getState, rejectWithValue }) => {
  const { page, limit, search } = getState().departments;
  try {
    const { data, meta } = await listDepartmentsRequest({ page, limit, search: search || undefined });
    return { items: data, meta: toPaginationMeta(meta, { page, limit, total: data.length }) };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchAllDepartments = createAsyncThunk<DepartmentRow[], void, { rejectValue: string }>(
  'departments/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await listDepartmentsRequest({ page: 1, limit: 999999 });
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const createDepartment = createAsyncThunk<DepartmentCreateResult, DepartmentPayload, { rejectValue: FieldAwareError }>(
  'departments/create',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await createDepartmentRequest(payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const updateDepartment = createAsyncThunk<DepartmentRow, { id: string; payload: DepartmentUpdatePayload }, { rejectValue: FieldAwareError }>(
  'departments/update',
  async ({ id, payload }, { rejectWithValue }) => {
    try {
      const { data } = await updateDepartmentRequest(id, payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const deleteDepartment = createAsyncThunk<void, string, { rejectValue: string }>(
  'departments/delete',
  async (id, { rejectWithValue }) => {
    try {
      await deleteDepartmentRequest(id);
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);
