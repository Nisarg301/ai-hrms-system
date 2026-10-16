import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  cancelAttendanceRequestRequest,
  clockInRequest,
  clockOutRequest,
  createAttendanceRequestRequest,
  getMyAttendanceRequestsRequest,
  getMyMonthRequest,
  getTodayRequest,
} from '../../services/endpoints/attendance.endpoints';
import type { AttendanceRequestPayload, AttendanceRequestRow, MonthView, TodayView } from '../../types/attendance';
import type { RootState } from '../index';
import { errorMessage, toFieldAwareError, type FieldAwareError } from '../thunkError';

export const fetchToday = createAsyncThunk<TodayView, void, { rejectValue: string }>('attendance/fetchToday', async (_, { rejectWithValue }) => {
  try {
    return (await getTodayRequest()).data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const clockIn = createAsyncThunk<TodayView, void, { rejectValue: string }>('attendance/clockIn', async (_, { rejectWithValue }) => {
  try {
    return (await clockInRequest()).data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const clockOut = createAsyncThunk<TodayView, void, { rejectValue: string }>('attendance/clockOut', async (_, { rejectWithValue }) => {
  try {
    return (await clockOutRequest()).data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchMyMonth = createAsyncThunk<MonthView, string, { rejectValue: string }>('attendance/fetchMonth', async (month, { rejectWithValue }) => {
  try {
    return (await getMyMonthRequest(month)).data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchMyAttendanceRequests = createAsyncThunk<AttendanceRequestRow[], void, { rejectValue: string }>(
  'attendance/fetchMyRequests',
  async (_, { rejectWithValue }) => {
    try {
      return (await getMyAttendanceRequestsRequest()).data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const createAttendanceRequest = createAsyncThunk<AttendanceRequestRow, AttendanceRequestPayload, { rejectValue: FieldAwareError }>(
  'attendance/createRequest',
  async (payload, { rejectWithValue }) => {
    try {
      return (await createAttendanceRequestRequest(payload)).data;
    } catch (err) {
      return rejectWithValue(toFieldAwareError(err));
    }
  }
);

export const cancelAttendanceRequest = createAsyncThunk<AttendanceRequestRow, string, { rejectValue: string }>(
  'attendance/cancelRequest',
  async (id, { rejectWithValue }) => {
    try {
      return (await cancelAttendanceRequestRequest(id)).data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/** After a request or a clock change: reload whatever of mine has been loaded. */
export const refreshMyAttendance = createAsyncThunk<void, void, { state: RootState }>('attendance/refresh', async (_, { dispatch, getState }) => {
  const s = getState().attendance;
  await Promise.all([
    s.today ? dispatch(fetchToday()) : null,
    s.month ? dispatch(fetchMyMonth(s.month.month)) : null,
    s.requestsStatus !== 'idle' ? dispatch(fetchMyAttendanceRequests()) : null,
  ]);
});
