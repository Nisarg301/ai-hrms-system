import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../index';

export const selectAuditLogs = (state: RootState) => state.auditLogs.items;
export const selectAuditLogsLoading = (state: RootState) => state.auditLogs.status === 'loading';
export const selectAuditLogsError = (state: RootState) => state.auditLogs.error;
export const selectAuditLogFilters = (state: RootState) => state.auditLogs.filters;
export const selectAuditLogsPagination = createSelector(
  [(state: RootState) => state.auditLogs.page, (state: RootState) => state.auditLogs.limit, (state: RootState) => state.auditLogs.total],
  (page, limit, total) => ({ page, limit, total })
);
