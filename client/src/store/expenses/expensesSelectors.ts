import type { RootState } from '../index';

export const selectExpenses = (state: RootState) => state.expenses;
