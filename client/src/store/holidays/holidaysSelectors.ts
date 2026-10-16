import type { RootState } from '../index';

export const selectHolidays = (state: RootState) => state.holidays.items;
export const selectHolidaysStatus = (state: RootState) => state.holidays.status;
export const selectHolidaysError = (state: RootState) => state.holidays.error;
