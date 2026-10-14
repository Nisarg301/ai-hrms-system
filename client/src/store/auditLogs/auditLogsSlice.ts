import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { AuditLogFilters, AuditLogRow } from '../../types/auditLog';
import { fetchAuditLogs } from './auditLogsThunks';

export interface AuditLogsState {
  items: AuditLogRow[];
  total: number;
  page: number;
  limit: number;
  filters: AuditLogFilters;
  status: ListStatus;
  error: string | null;
}

const initialState: AuditLogsState = {
  items: [],
  total: 0,
  page: 1,
  limit: 20,
  filters: {},
  status: 'idle',
  error: null,
};

const auditLogsSlice = createSlice({
  name: 'auditLogs',
  initialState,
  reducers: {
    filtersChanged(state, action: PayloadAction<AuditLogFilters>) {
      state.filters = action.payload;
      state.page = 1;
    },
    pageChanged(state, action: PayloadAction<{ page: number; limit: number }>) {
      state.page = action.payload.page;
      state.limit = action.payload.limit;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAuditLogs.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchAuditLogs.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.items = action.payload.items;
        state.total = action.payload.meta.total;
      })
      .addCase(fetchAuditLogs.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload ?? 'Could not load audit logs';
      });
  },
});

export const { filtersChanged, pageChanged } = auditLogsSlice.actions;
export const auditLogsReducer = auditLogsSlice.reducer;
