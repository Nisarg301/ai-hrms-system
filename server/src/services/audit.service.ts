import { Request } from 'express';
import { Types } from 'mongoose';
import { UserRoleName } from '../constants/roles';
import { AuditAction, AuditModule } from '../models/auditLog.model';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { getSubscriptionForOrg, SubscriptionState } from './subscription.service';

interface AuditEntry {
  organizationId: Types.ObjectId | string;
  actor: { id: string; name: string; role: UserRoleName };
  action: AuditAction;
  module?: AuditModule | null;
  recordId?: string | null;
  recordLabel?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export const auditService = {
  /**
   * Writes only for an organization whose active plan includes Audit Logs, so
   * Basic or expired orgs accrue nothing. Never records SUPER_ADMIN, and never
   * fails the caller's request: a lost audit row is logged, not thrown.
   */
  async record(entry: AuditEntry, subscription?: SubscriptionState | null): Promise<void> {
    try {
      if (entry.actor.role === 'SUPER_ADMIN') return;
      const state = subscription ?? (await getSubscriptionForOrg(entry.organizationId));
      if (!state?.active || !state.modules.includes('auditLogs')) return;
      await auditLogRepository.create({
        organizationId: new Types.ObjectId(entry.organizationId.toString()),
        actorId: new Types.ObjectId(entry.actor.id),
        actorName: entry.actor.name,
        actorRole: entry.actor.role,
        action: entry.action,
        module: entry.module ?? null,
        recordId: entry.recordId ?? null,
        recordLabel: entry.recordLabel ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      });
    } catch (err) {
      console.error('Failed to write audit log', err);
    }
  },
};

/** CRUD shorthand for controllers behind requireActivePlan (req.subscription is already loaded). */
export function auditCrud(
  req: Request,
  action: 'create' | 'update' | 'delete',
  module: AuditModule,
  record: { id: string; label: string }
): Promise<void> {
  return auditService.record(
    {
      organizationId: req.orgFilter!.organizationId,
      actor: { id: req.user!.id, name: req.user!.name ?? '', role: req.user!.role },
      action,
      module,
      recordId: record.id,
      recordLabel: record.label,
    },
    req.subscription
  );
}
