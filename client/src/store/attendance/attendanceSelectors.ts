import type { RootState } from '../index';

export const selectAttendance = (state: RootState) => state.attendance;
export const selectToday = (state: RootState) => state.attendance.today;
export const selectMyMonth = (state: RootState) => state.attendance.month;
export const selectMyAttendanceRequests = (state: RootState) => state.attendance.requests;
