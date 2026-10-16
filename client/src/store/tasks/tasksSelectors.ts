import type { RootState } from '../index';

export const selectTasks = (state: RootState) => state.tasks.items;
export const selectTasksLoading = (state: RootState) => state.tasks.status === 'loading';
export const selectTasksError = (state: RootState) => state.tasks.error;
export const selectTasksPagination = (state: RootState) => ({
  page: state.tasks.page,
  limit: state.tasks.limit,
  total: state.tasks.total,
});
