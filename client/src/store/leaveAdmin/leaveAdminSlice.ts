import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { AdminLeaveRequestRow, LeaveRequestFilters, LeaveType } from '../../types/leave';
import {
  decideLeave,
  deleteLeaveType,
  fetchLeaveRequests,
  fetchLeaveTypes,
  fetchPendingCount,
  updateLeaveType,
  createLeaveType,
} from './leaveAdminThunks';

export type ApprovalsView = 'pending' | 'all';

export interface LeaveAdminState {
  view: ApprovalsView;
  filters: LeaveRequestFilters;
  page: number;
  limit: number;
  total: number;
  items: AdminLeaveRequestRow[];
  status: ListStatus;
  error: string | null;
  /** The sidebar badge. null until first loaded. */
  pendingCount: number | null;
  types: LeaveType[];
  typesStatus: ListStatus;
  typesError: string | null;
}

const initialState: LeaveAdminState = {
  view: 'pending',
  filters: {},
  page: 1,
  limit: 20,
  total: 0,
  items: [],
  status: 'idle',
  error: null,
  pendingCount: null,
  types: [],
  typesStatus: 'idle',
  typesError: null,
};

const byName = (a: LeaveType, b: LeaveType) => a.name.localeCompare(b.name);

const leaveAdminSlice = createSlice({
  name: 'leaveAdmin',
  initialState,
  reducers: {
    setApprovalsView(state, action: PayloadAction<ApprovalsView>) {
      state.view = action.payload;
      state.page = 1;
      state.items = [];
    },
    setLeaveFilters(state, action: PayloadAction<LeaveRequestFilters>) {
      state.filters = action.payload;
      state.page = 1;
    },
    setLeavePage(state, action: PayloadAction<{ page: number; limit: number }>) {
      state.page = action.payload.page;
      state.limit = action.payload.limit;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchLeaveRequests.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchLeaveRequests.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.items = action.payload.items;
        state.total = action.payload.meta.total;
      })
      .addCase(fetchLeaveRequests.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload ?? 'Could not load leave requests';
      })
      .addCase(fetchPendingCount.fulfilled, (state, action) => {
        state.pendingCount = action.payload;
      })
      .addCase(decideLeave.fulfilled, (state, action) => {
        // On Pending the row leaves the list; on All it updates in place.
        if (state.view === 'pending') {
          state.items = state.items.filter((r) => r.id !== action.payload.id);
          state.total = Math.max(0, state.total - 1);
        } else {
          const row = state.items.find((r) => r.id === action.payload.id);
          if (row) Object.assign(row, action.payload, { availableAfter: null });
        }
      })
      .addCase(fetchLeaveTypes.pending, (state) => {
        state.typesStatus = 'loading';
        state.typesError = null;
      })
      .addCase(fetchLeaveTypes.fulfilled, (state, action) => {
        state.typesStatus = 'succeeded';
        state.types = action.payload;
      })
      .addCase(fetchLeaveTypes.rejected, (state, action) => {
        state.typesStatus = 'failed';
        state.typesError = action.payload ?? 'Could not load leave types';
      })
      .addCase(createLeaveType.fulfilled, (state, action) => {
        state.types = [...state.types, action.payload].sort(byName);
      })
      .addCase(updateLeaveType.fulfilled, (state, action) => {
        state.types = state.types.map((t) => (t.id === action.payload.id ? action.payload : t)).sort(byName);
      })
      .addCase(deleteLeaveType.fulfilled, (state, action) => {
        state.types = state.types.filter((t) => t.id !== action.payload);
      });
  },
});

export const { setApprovalsView, setLeaveFilters, setLeavePage } = leaveAdminSlice.actions;
export const leaveAdminReducer = leaveAdminSlice.reducer;
