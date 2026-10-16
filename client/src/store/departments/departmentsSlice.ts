import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { DepartmentRow } from '../../types/department';
import { fetchAllDepartments, fetchDepartments } from './departmentsThunks';

export interface DepartmentsState {
  items: DepartmentRow[];
  allItems: DepartmentRow[];
  total: number;
  page: number;
  limit: number;
  search: string;
  status: ListStatus;
  error: string | null;
}

const initialState: DepartmentsState = {
  items: [],
  allItems: [],
  total: 0,
  page: 1,
  limit: 10,
  search: '',
  status: 'idle',
  error: null,
};

const departmentsSlice = createSlice({
  name: 'departments',
  initialState,
  reducers: {
    searchChanged(state, action: PayloadAction<string>) {
      state.search = action.payload;
      state.page = 1;
    },
    pageChanged(state, action: PayloadAction<{ page: number; limit: number }>) {
      state.page = action.payload.page;
      state.limit = action.payload.limit;
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDepartments.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchDepartments.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.items = action.payload.items;
        state.total = action.payload.meta.total;
      })
      .addCase(fetchDepartments.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload ?? 'Could not load departments';
      })
      .addCase(fetchAllDepartments.fulfilled, (state, action) => {
        state.allItems = action.payload;
      })
  },
});

export const { searchChanged, pageChanged } = departmentsSlice.actions;
export const departmentsReducer = departmentsSlice.reducer;
