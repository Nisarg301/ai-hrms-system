import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  applyLeaveRequest,
  cancelLeaveRequest,
  getMyBalancesRequest,
  getMyLeaveRequestsRequest,
} from '../../services/endpoints/leave.endpoints';
import type { ApplyLeavePayload, LeaveBalance, LeaveRequestRow } from '../../types/leave';
import { fetchHomeSummary } from '../home/homeThunks';
import type { RootState } from '../index';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';

export const fetchMyBalances = createAsyncThunk<LeaveBalance[], void, { rejectValue: string }>(
  'leave/fetchMyBalances',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await getMyBalancesRequest();
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const fetchMyLeaveRequests = createAsyncThunk<LeaveRequestRow[], void, { rejectValue: string }>(
  'leave/fetchMyRequests',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await getMyLeaveRequestsRequest();
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const applyLeave = createAsyncThunk<LeaveRequestRow, ApplyLeavePayload, { rejectValue: FieldAwareError }>(
  'leave/apply',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await applyLeaveRequest(payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const cancelLeave = createAsyncThunk<LeaveRequestRow, string, { rejectValue: string }>(
  'leave/cancel',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await cancelLeaveRequest(id);
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/**
 * After applying or cancelling: balances and my requests change, and so does the
 * Home summary (balances, who's out). Only reloads what has been loaded before.
 */
export const refreshAfterLeaveChange = createAsyncThunk<void, void, { state: RootState }>(
  'leave/refreshAfterChange',
  async (_, { dispatch, getState }) => {
    const state = getState();
    await Promise.all([
      dispatch(fetchMyBalances()),
      state.leave.requestsStatus !== 'idle' ? dispatch(fetchMyLeaveRequests()) : Promise.resolve(),
      state.home.summary ? dispatch(fetchHomeSummary()) : Promise.resolve(),
    ]);
  }
);
