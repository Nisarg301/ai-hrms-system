import type { RootState } from '../index';

export const selectLeaveAdmin = (state: RootState) => state.leaveAdmin;
export const selectPendingCount = (state: RootState) => state.leaveAdmin.pendingCount;
export const selectLeaveTypes = (state: RootState) => state.leaveAdmin.types;
export const selectLeaveTypesStatus = (state: RootState) => state.leaveAdmin.typesStatus;
export const selectLeaveTypesError = (state: RootState) => state.leaveAdmin.typesError;
