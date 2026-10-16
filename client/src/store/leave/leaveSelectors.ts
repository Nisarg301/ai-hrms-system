import type { RootState } from '../index';

export const selectMyBalances = (state: RootState) => state.leave.balances;
export const selectMyBalancesStatus = (state: RootState) => state.leave.balancesStatus;
export const selectMyBalancesError = (state: RootState) => state.leave.balancesError;
export const selectMyLeaveRequests = (state: RootState) => state.leave.requests;
export const selectMyLeaveRequestsStatus = (state: RootState) => state.leave.requestsStatus;
export const selectMyLeaveRequestsError = (state: RootState) => state.leave.requestsError;
