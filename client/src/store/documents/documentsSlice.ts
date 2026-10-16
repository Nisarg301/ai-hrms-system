import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { DocumentRow } from '../../types/document';
import { fetchDocuments } from './documentsThunks';

export interface DocumentsState {
  items: DocumentRow[];
  total: number;
  page: number;
  limit: number;
  search: string;
  status: ListStatus;
  error: string | null;
}

const initialState: DocumentsState = {
  items: [],
  total: 0,
  page: 1,
  limit: 10,
  search: '',
  status: 'idle',
  error: null,
};

const documentsSlice = createSlice({
  name: 'documents',
  initialState,
  reducers: {
    searchChanged(state, action: PayloadAction<string>) {
      state.search = action.payload;
      state.page = 1;
    },
    pageChanged(state, action: PayloadAction<{ page: number; limit: number }>) {
      state.page = action.payload.page;
      state.limit = action.payload.limit;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDocuments.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchDocuments.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.items = action.payload.items;
        state.total = action.payload.meta.total;
      })
      .addCase(fetchDocuments.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload ?? 'Could not load documents';
      });
  },
});

export const { searchChanged, pageChanged } = documentsSlice.actions;
export const documentsReducer = documentsSlice.reducer;
