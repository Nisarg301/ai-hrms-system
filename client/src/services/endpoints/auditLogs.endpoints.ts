import { callApiServices } from '../callApiServices';
import type { AuditLogFilters, AuditLogRow } from '../../types/auditLog';

export function listAuditLogsRequest(params: { page: number; limit: number } & AuditLogFilters) {
  return callApiServices<AuditLogRow[]>('/audit-logs', 'get', true, params);
}
