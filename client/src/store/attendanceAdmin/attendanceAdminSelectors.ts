import type { RootState } from '../index';

export const selectAttendanceAdmin = (state: RootState) => state.attendanceAdmin;
export const selectAttendancePendingCounts = (state: RootState) => state.attendanceAdmin.pendingCounts;
