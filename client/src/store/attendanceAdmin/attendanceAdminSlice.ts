import { createSlice } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { AttendancePendingCounts, AttendanceRequestRow, Schedule, TeamDay, TeamMonth } from '../../types/attendance';
import {
  decideAttendanceRequest,
  fetchAttendancePendingCounts,
  fetchAttendanceRequests,
  fetchSchedule,
  fetchTeamDay,
  fetchTeamMonth,
  saveSchedule,
} from './attendanceAdminThunks';

export interface AttendanceAdminState {
  requests: AttendanceRequestRow[];
  requestsTotal: number;
  requestsStatus: ListStatus;
  requestsError: string | null;
  pendingCounts: AttendancePendingCounts | null;
  teamDay: TeamDay | null;
  teamMonth: TeamMonth | null;
  teamStatus: ListStatus;
  teamError: string | null;
  schedule: Schedule | null;
}

const initialState: AttendanceAdminState = {
  requests: [],
  requestsTotal: 0,
  requestsStatus: 'idle',
  requestsError: null,
  pendingCounts: null,
  teamDay: null,
  teamMonth: null,
  teamStatus: 'idle',
  teamError: null,
  schedule: null,
};

const attendanceAdminSlice = createSlice({
  name: 'attendanceAdmin',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    const teamPending = (state: AttendanceAdminState) => {
      state.teamStatus = 'loading';
      state.teamError = null;
    };
    const teamFailed = (state: AttendanceAdminState, error: string | undefined) => {
      state.teamStatus = 'failed';
      state.teamError = error ?? 'Could not load team attendance';
    };
    builder
      .addCase(fetchAttendanceRequests.pending, (state) => {
        state.requestsStatus = 'loading';
        state.requestsError = null;
      })
      .addCase(fetchAttendanceRequests.fulfilled, (state, action) => {
        state.requestsStatus = 'succeeded';
        state.requests = action.payload.items;
        state.requestsTotal = action.payload.meta.total;
      })
      .addCase(fetchAttendanceRequests.rejected, (state, action) => {
        state.requestsStatus = 'failed';
        state.requestsError = action.payload ?? 'Could not load requests';
      })
      .addCase(fetchAttendancePendingCounts.fulfilled, (state, action) => {
        state.pendingCounts = action.payload;
      })
      .addCase(decideAttendanceRequest.fulfilled, (state, action) => {
        state.requests = state.requests.map((r) => (r.id === action.payload.id ? action.payload : r));
      })
      .addCase(fetchTeamDay.pending, teamPending)
      .addCase(fetchTeamDay.fulfilled, (state, action) => {
        state.teamStatus = 'succeeded';
        state.teamDay = action.payload;
      })
      .addCase(fetchTeamDay.rejected, (state, action) => teamFailed(state, action.payload))
      .addCase(fetchTeamMonth.pending, teamPending)
      .addCase(fetchTeamMonth.fulfilled, (state, action) => {
        state.teamStatus = 'succeeded';
        state.teamMonth = action.payload;
      })
      .addCase(fetchTeamMonth.rejected, (state, action) => teamFailed(state, action.payload))
      .addCase(fetchSchedule.fulfilled, (state, action) => {
        state.schedule = action.payload;
      })
      .addCase(saveSchedule.fulfilled, (state, action) => {
        state.schedule = action.payload;
      });
  },
});

export const attendanceAdminReducer = attendanceAdminSlice.reducer;
