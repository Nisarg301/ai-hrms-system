import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { EmployeeRow } from '../../types/employee';
import { createEmployee, fetchAllEmployees, fetchEmployees } from './employeesThunks';

export interface EmployeesState {
  items: EmployeeRow[];
  allItems: EmployeeRow[];
  total: number;
  page: number;
  limit: number;
  search: string;
  status: ListStatus;
  error: string | null;
  tempPassword: string | null;
}

const initialState: EmployeesState = {
  items: [],
  allItems: [],
  total: 0,
  page: 1,
  limit: 10,
  search: '',
  status: 'idle',
  error: null,
  tempPassword: null,
};

const employeesSlice = createSlice({
  name: 'employees',
  initialState,
  reducers: {
    searchChanged(state, action: PayloadAction<string>) {
      state.search = action.payload;
      state.page = 1;
    },
    pageChanged(state, action: PayloadAction<{ page: number; limit: number }>) {
      state.page = action.payload.page;
      state.limit = action.payload.limit;
    },
    tempPasswordCleared(state) {
      state.tempPassword = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchEmployees.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchEmployees.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.items = action.payload.items;
        state.total = action.payload.meta.total;
      })
      .addCase(fetchEmployees.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload ?? 'Could not load employees';
      })
      .addCase(createEmployee.fulfilled, (state, action) => {
        state.tempPassword = action.payload.temp_password;
      })
      .addCase(fetchAllEmployees.fulfilled, (state, action) => {
        state.allItems = action.payload;
      })
  },
});

export const { searchChanged, pageChanged, tempPasswordCleared } = employeesSlice.actions;
export const employeesReducer = employeesSlice.reducer;
