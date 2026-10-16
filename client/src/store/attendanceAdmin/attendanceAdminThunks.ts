import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  decideAttendanceRequestRequest,
  getAttendancePendingCountRequest,
  getScheduleRequest,
  getTeamDayRequest,
  getTeamMonthRequest,
  listAttendanceRequestsRequest,
  recordFixRequest,
  updateScheduleRequest,
} from '../../services/endpoints/attendance.endpoints';
import { toPaginationMeta, type PaginationMeta } from '../../types/api';
import type {
  AttendancePendingCounts,
  AttendanceRequestKind,
  AttendanceRequestRow,
  AttendanceRequestStatus,
  RecordFixPayload,
  Schedule,
  TeamDay,
  TeamMonth,
} from '../../types/attendance';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';

export const fetchAttendanceRequests = createAsyncThunk<
  { items: AttendanceRequestRow[]; meta: PaginationMeta },
  { kind: AttendanceRequestKind; status?: AttendanceRequestStatus; page?: number },
  { rejectValue: string }
>('attendanceAdmin/fetchRequests', async ({ kind, status, page = 1 }, { rejectWithValue }) => {
  const limit = 20;
  try {
    const { data, meta } = await listAttendanceRequestsRequest({ kind, status, page, limit });
    return { items: data, meta: toPaginationMeta(meta, { page, limit, total: data.length }) };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchAttendancePendingCounts = createAsyncThunk<AttendancePendingCounts, void, { rejectValue: string }>(
  'attendanceAdmin/fetchPendingCounts',
  async (_, { rejectWithValue }) => {
    try {
      return (await getAttendancePendingCountRequest()).data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const decideAttendanceRequest = createAsyncThunk<
  AttendanceRequestRow,
  { id: string; action: 'approve' | 'reject'; note: string },
  { rejectValue: string }
>('attendanceAdmin/decide', async ({ id, action, note }, { dispatch, rejectWithValue }) => {
  try {
    return (await decideAttendanceRequestRequest(id, action, note)).data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  } finally {
    void dispatch(fetchAttendancePendingCounts());
  }
});

export const recordFix = createAsyncThunk<AttendanceRequestRow, RecordFixPayload, { rejectValue: FieldAwareError }>(
  'attendanceAdmin/recordFix',
  async (payload, { rejectWithValue }) => {
    try {
      return (await recordFixRequest(payload)).data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const fetchTeamDay = createAsyncThunk<TeamDay, { date?: string; departmentId?: string }, { rejectValue: string }>(
  'attendanceAdmin/fetchTeamDay',
  async (params, { rejectWithValue }) => {
    try {
      return (await getTeamDayRequest(params)).data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const fetchTeamMonth = createAsyncThunk<TeamMonth, { month?: string; departmentId?: string }, { rejectValue: string }>(
  'attendanceAdmin/fetchTeamMonth',
  async (params, { rejectWithValue }) => {
    try {
      return (await getTeamMonthRequest(params)).data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const fetchSchedule = createAsyncThunk<Schedule, void, { rejectValue: string }>('attendanceAdmin/fetchSchedule', async (_, { rejectWithValue }) => {
  try {
    return (await getScheduleRequest()).data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const saveSchedule = createAsyncThunk<Schedule, Schedule, { rejectValue: FieldAwareError }>(
  'attendanceAdmin/saveSchedule',
  async (payload, { rejectWithValue }) => {
    try {
      return (await updateScheduleRequest(payload)).data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);
