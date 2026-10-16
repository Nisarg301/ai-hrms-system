import type { RootState } from '../index';

export const selectHomeSummary = (state: RootState) => state.home.summary;
export const selectHomeLoading = (state: RootState) => state.home.status === 'loading' || state.home.status === 'idle';
export const selectHomeError = (state: RootState) => state.home.error;
