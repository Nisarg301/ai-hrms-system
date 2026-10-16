import type { RootState } from '../index';

export const selectAdminUsers = (state: RootState) => state.adminUsers.items;
export const selectAdminUsersLoading = (state: RootState) => state.adminUsers.status === 'loading';
export const selectAdminUsersError = (state: RootState) => state.adminUsers.error;
export const selectAdminUsersSearch = (state: RootState) => state.adminUsers.search;
export const selectAdminUsersTempPassword = (state: RootState) => state.adminUsers.tempPassword;
export const selectOrganizations = (state: RootState) => state.adminUsers.organizations;
export const selectAdminUsersPagination = (state: RootState) => ({
  page: state.adminUsers.page,
  limit: state.adminUsers.limit,
  total: state.adminUsers.total,
});
