import type { RootState } from '../index';

export const selectExpensesAdmin = (state: RootState) => state.expensesAdmin;
export const selectExpensePendingCount = (state: RootState) => state.expensesAdmin.pendingCount;
