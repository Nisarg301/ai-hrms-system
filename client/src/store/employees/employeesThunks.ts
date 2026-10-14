import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  createEmployeeRequest,
  deleteEmployeeRequest,
  listEmployeesRequest,
  updateEmployeeRequest,
} from '../../services/endpoints/employees.endpoints';
import { toPaginationMeta, type PaginationMeta } from '../../types/api';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';
import type { EmployeeCreateResult, EmployeePayload, EmployeeRow, EmployeeUpdatePayload } from '../../types/employee';
import type { RootState } from '../index';

export const fetchEmployees = createAsyncThunk<
  { items: EmployeeRow[]; meta: PaginationMeta },
  void,
  { state: RootState; rejectValue: string }
>('employees/fetch', async (_, { getState, rejectWithValue }) => {
  const { page, limit, search } = getState().employees;
  try {
    const { data, meta } = await listEmployeesRequest({ page, limit, search: search || undefined });
    return { items: data, meta: toPaginationMeta(meta, { page, limit, total: data.length }) };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchAllEmployees = createAsyncThunk<EmployeeRow[], void, { rejectValue: string }>(
  'employees/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await listEmployeesRequest({ page: 1, limit: 999999 });
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const createEmployee = createAsyncThunk<EmployeeCreateResult, EmployeePayload, { rejectValue: FieldAwareError }>(
  'employees/create',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await createEmployeeRequest(payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const updateEmployee = createAsyncThunk<EmployeeRow, { id: string; payload: EmployeeUpdatePayload }, { rejectValue: FieldAwareError }>(
  'employees/update',
  async ({ id, payload }, { rejectWithValue }) => {
    try {
      const { data } = await updateEmployeeRequest(id, payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const deleteEmployee = createAsyncThunk<void, string, { rejectValue: string }>(
  'employees/delete',
  async (id, { rejectWithValue }) => {
    try {
      await deleteEmployeeRequest(id);
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);
