import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  approveLeaveRequest,
  createLeaveTypeRequest,
  deleteLeaveTypeRequest,
  getPendingCountRequest,
  listLeaveRequestsRequest,
  listLeaveTypesRequest,
  recordLeaveRequest,
  rejectLeaveRequest,
  updateLeaveTypeRequest,
} from '../../services/endpoints/leaveAdmin.endpoints';
import { toPaginationMeta, type PaginationMeta } from '../../types/api';
import type { AdminLeaveRequestRow, LeaveRequestRow, LeaveType, LeaveTypePayload, RecordLeavePayload } from '../../types/leave';
import type { RootState } from '../index';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';

/** The Pending tab (oldest first) or the All tab (newest first, filtered). */
export const fetchLeaveRequests = createAsyncThunk<
  { items: AdminLeaveRequestRow[]; meta: PaginationMeta },
  void,
  { state: RootState; rejectValue: string }
>('leaveAdmin/fetchRequests', async (_, { getState, rejectWithValue }) => {
  const { view, filters, page, limit } = getState().leaveAdmin;
  const params = view === 'pending' ? { status: 'pending' as const, page, limit } : { ...filters, page, limit };
  try {
    const { data, meta } = await listLeaveRequestsRequest(params);
    return { items: data, meta: toPaginationMeta(meta, { page, limit, total: data.length }) };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchPendingCount = createAsyncThunk<number, void, { rejectValue: string }>(
  'leaveAdmin/fetchPendingCount',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await getPendingCountRequest();
      return data.count;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const decideLeave = createAsyncThunk<
  LeaveRequestRow,
  { id: string; action: 'approve' | 'reject'; note: string },
  { rejectValue: string }
>('leaveAdmin/decide', async ({ id, action, note }, { dispatch, rejectWithValue }) => {
  try {
    const { data } = action === 'approve' ? await approveLeaveRequest(id, note) : await rejectLeaveRequest(id, note);
    return data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  } finally {
    // Right or wrong (e.g. another admin decided first), the count may have moved.
    void dispatch(fetchPendingCount());
  }
});

/** Leave an ORG_ADMIN records for someone, approved straight away. */
export const recordLeave = createAsyncThunk<LeaveRequestRow, RecordLeavePayload, { rejectValue: FieldAwareError }>(
  'leaveAdmin/record',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await recordLeaveRequest(payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const fetchLeaveTypes = createAsyncThunk<LeaveType[], void, { rejectValue: string }>(
  'leaveAdmin/fetchTypes',
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await listLeaveTypesRequest();
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const createLeaveType = createAsyncThunk<LeaveType, LeaveTypePayload, { rejectValue: FieldAwareError }>(
  'leaveAdmin/createType',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await createLeaveTypeRequest(payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const updateLeaveType = createAsyncThunk<LeaveType, { id: string; payload: Partial<LeaveTypePayload> }, { rejectValue: FieldAwareError }>(
  'leaveAdmin/updateType',
  async ({ id, payload }, { rejectWithValue }) => {
    try {
      const { data } = await updateLeaveTypeRequest(id, payload);
      return data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const deleteLeaveType = createAsyncThunk<string, string, { rejectValue: string }>(
  'leaveAdmin/deleteType',
  async (id, { rejectWithValue }) => {
    try {
      await deleteLeaveTypeRequest(id);
      return id;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

