import { AuditLogModel, IAuditLog } from '../models/auditLog.model';
import { BaseRepository } from './base.repository';

export class AuditLogRepository extends BaseRepository<IAuditLog> {
  constructor() {
    super(AuditLogModel);
  }
}

export const auditLogRepository = new AuditLogRepository();
