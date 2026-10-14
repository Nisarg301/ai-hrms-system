import { createSlice } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { AttendanceRequestRow, MonthView, TodayView } from '../../types/attendance';
import {
  cancelAttendanceRequest,
  clockIn,
  clockOut,
  fetchMyAttendanceRequests,
  fetchMyMonth,
  fetchToday,
} from './attendanceThunks';

/** My own attendance: today's clock, a month, and my fix / WFH requests. */
export interface AttendanceState {
  today: TodayView | null;
  /** Local time the `today` snapshot arrived, so the live timer can count on from it. */
  todayLoadedAt: number | null;
  todayStatus: ListStatus;
  todayError: string | null;
  clocking: boolean;
  month: MonthView | null;
  monthStatus: ListStatus;
  monthError: string | null;
  requests: AttendanceRequestRow[];
  requestsStatus: ListStatus;
}

const initialState: AttendanceState = {
  today: null,
  todayLoadedAt: null,
  todayStatus: 'idle',
  todayError: null,
  clocking: false,
  month: null,
  monthStatus: 'idle',
  monthError: null,
  requests: [],
  requestsStatus: 'idle',
};

const attendanceSlice = createSlice({
  name: 'attendance',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    const setToday = (state: AttendanceState, today: TodayView) => {
      state.today = today;
      state.todayLoadedAt = Date.now();
      state.todayStatus = 'succeeded';
      state.todayError = null;
    };
    builder
      .addCase(fetchToday.pending, (state) => {
        if (!state.today) state.todayStatus = 'loading';
      })
      .addCase(fetchToday.fulfilled, (state, action) => setToday(state, action.payload))
      .addCase(fetchToday.rejected, (state, action) => {
        state.todayStatus = 'failed';
        state.todayError = action.payload ?? 'Could not load your attendance';
      })
      .addCase(clockIn.pending, (state) => {
        state.clocking = true;
      })
      .addCase(clockOut.pending, (state) => {
        state.clocking = true;
      })
      .addCase(clockIn.fulfilled, (state, action) => {
        state.clocking = false;
        setToday(state, action.payload);
      })
      .addCase(clockOut.fulfilled, (state, action) => {
        state.clocking = false;
        setToday(state, action.payload);
      })
      .addCase(clockIn.rejected, (state) => {
        state.clocking = false;
      })
      .addCase(clockOut.rejected, (state) => {
        state.clocking = false;
      })
      .addCase(fetchMyMonth.pending, (state, action) => {
        state.monthStatus = 'loading';
        state.monthError = null;
        if (state.month?.month !== action.meta.arg) state.month = null;
      })
      .addCase(fetchMyMonth.fulfilled, (state, action) => {
        state.monthStatus = 'succeeded';
        state.month = action.payload;
      })
      .addCase(fetchMyMonth.rejected, (state, action) => {
        state.monthStatus = 'failed';
        state.monthError = action.payload ?? 'Could not load your attendance';
      })
      .addCase(fetchMyAttendanceRequests.pending, (state) => {
        if (state.requestsStatus === 'idle') state.requestsStatus = 'loading';
      })
      .addCase(fetchMyAttendanceRequests.fulfilled, (state, action) => {
        state.requestsStatus = 'succeeded';
        state.requests = action.payload;
      })
      .addCase(fetchMyAttendanceRequests.rejected, (state) => {
        state.requestsStatus = 'failed';
      })
      .addCase(cancelAttendanceRequest.fulfilled, (state, action) => {
        state.requests = state.requests.map((r) => (r.id === action.payload.id ? action.payload : r));
      });
  },
});

export const attendanceReducer = attendanceSlice.reducer;
