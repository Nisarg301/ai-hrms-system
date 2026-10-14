import type { RootState } from '../index';

export const selectProjects = (state: RootState) => state.projects.items;
export const selectAllProjects = (state: RootState) => state.projects.allItems;
export const selectProjectsLoading = (state: RootState) => state.projects.status === 'loading';
export const selectProjectsError = (state: RootState) => state.projects.error;
export const selectProjectsPagination = (state: RootState) => ({
  page: state.projects.page,
  limit: state.projects.limit,
  total: state.projects.total,
});
