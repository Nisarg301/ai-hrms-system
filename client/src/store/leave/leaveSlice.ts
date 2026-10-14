import { createSlice } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { LeaveBalance, LeaveRequestRow } from '../../types/leave';
import { cancelLeave, fetchMyBalances, fetchMyLeaveRequests } from './leaveThunks';

/** My own leave: balances and requests. (The ORG_ADMIN's approvals live elsewhere.) */
export interface LeaveState {
  balances: LeaveBalance[];
  balancesStatus: ListStatus;
  balancesError: string | null;
  requests: LeaveRequestRow[];
  requestsStatus: ListStatus;
  requestsError: string | null;
}

const initialState: LeaveState = {
  balances: [],
  balancesStatus: 'idle',
  balancesError: null,
  requests: [],
  requestsStatus: 'idle',
  requestsError: null,
};

const leaveSlice = createSlice({
  name: 'leave',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchMyBalances.pending, (state) => {
        if (state.balancesStatus === 'idle') state.balancesStatus = 'loading';
        state.balancesError = null;
      })
      .addCase(fetchMyBalances.fulfilled, (state, action) => {
        state.balancesStatus = 'succeeded';
        state.balances = action.payload;
      })
      .addCase(fetchMyBalances.rejected, (state, action) => {
        state.balancesStatus = 'failed';
        state.balancesError = action.payload ?? 'Could not load your balances';
      })
      .addCase(fetchMyLeaveRequests.pending, (state) => {
        if (state.requestsStatus === 'idle') state.requestsStatus = 'loading';
        state.requestsError = null;
      })
      .addCase(fetchMyLeaveRequests.fulfilled, (state, action) => {
        state.requestsStatus = 'succeeded';
        state.requests = action.payload;
      })
      .addCase(fetchMyLeaveRequests.rejected, (state, action) => {
        state.requestsStatus = 'failed';
        state.requestsError = action.payload ?? 'Could not load your leave requests';
      })
      .addCase(cancelLeave.fulfilled, (state, action) => {
        const i = state.requests.findIndex((r) => r.id === action.payload.id);
        if (i >= 0) state.requests[i] = action.payload;
      });
  },
});

export const leaveReducer = leaveSlice.reducer;
