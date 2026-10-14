import type { RootState } from '../index';

export const selectRoles = (state: RootState) => state.roles.items;
export const selectRolesLoading = (state: RootState) => state.roles.status === 'loading';
export const selectRolesError = (state: RootState) => state.roles.error;
export const selectRolesPagination = (state: RootState) => ({
  page: state.roles.page,
  limit: state.roles.limit,
  total: state.roles.total,
});
