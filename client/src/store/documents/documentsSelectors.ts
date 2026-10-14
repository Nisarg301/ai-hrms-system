import type { RootState } from '../index';

export const selectDocuments = (state: RootState) => state.documents.items;
export const selectDocumentsLoading = (state: RootState) => state.documents.status === 'loading';
export const selectDocumentsError = (state: RootState) => state.documents.error;
export const selectDocumentsPagination = (state: RootState) => ({
  page: state.documents.page,
  limit: state.documents.limit,
  total: state.documents.total,
});
