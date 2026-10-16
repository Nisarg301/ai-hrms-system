import type { RootState } from '../index';

export const selectEmployees = (state: RootState) => state.employees.items;
export const selectAllEmployees = (state: RootState) => state.employees.allItems;
export const selectEmployeesLoading = (state: RootState) => state.employees.status === 'loading';
export const selectEmployeesError = (state: RootState) => state.employees.error;
export const selectEmployeesTempPassword = (state: RootState) => state.employees.tempPassword;
export const selectEmployeesPagination = (state: RootState) => ({
  page: state.employees.page,
  limit: state.employees.limit,
  total: state.employees.total,
});
