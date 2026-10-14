import { createAsyncThunk } from '@reduxjs/toolkit';
import { listAuditLogsRequest } from '../../services/endpoints/auditLogs.endpoints';
import { toPaginationMeta, type PaginationMeta } from '../../types/api';
import type { AuditLogRow } from '../../types/auditLog';
import { errorMessage } from '../thunkError';
import type { RootState } from '../index';

export const fetchAuditLogs = createAsyncThunk<
  { items: AuditLogRow[]; meta: PaginationMeta },
  void,
  { state: RootState; rejectValue: string }
>('auditLogs/fetch', async (_, { getState, rejectWithValue }) => {
  const { page, limit, filters } = getState().auditLogs;
  try {
    const { data, meta } = await listAuditLogsRequest({ page, limit, ...filters });
    return { items: data, meta: toPaginationMeta(meta, { page, limit, total: data.length }) };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});
