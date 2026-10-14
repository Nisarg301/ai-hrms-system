import type { RootState } from '../index';

export const selectDepartments = (state: RootState) => state.departments.items;
export const selectAllDepartments = (state: RootState) => state.departments.allItems;
export const selectDepartmentsLoading = (state: RootState) => state.departments.status === 'loading';
export const selectDepartmentsError = (state: RootState) => state.departments.error;
export const selectDepartmentsPagination = (state: RootState) => ({
  page: state.departments.page,
  limit: state.departments.limit,
  total: state.departments.total,
});
