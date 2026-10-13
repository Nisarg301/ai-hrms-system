import { Request, Response } from 'express';
import { QueryFilter } from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middlewares/asyncHandler';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { AUDIT_ACTIONS, AUDIT_MODULES, IAuditLog } from '../models/auditLog.model';
import { objectIdSchema } from '../validators/objectId';
import { successResponse, ApiError } from '../utils/apiResponse';
import { parsePaginationQuery } from '../utils/pagination';

const filtersSchema = z.object({
  module: z.enum(AUDIT_MODULES).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  actorId: objectIdSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function serialize(log: IAuditLog) {
  return {
    id: log._id!.toString(),
    actorId: log.actorId.toString(),
    actorName: log.actorName,
    actorRole: log.actorRole,
    action: log.action,
    module: log.module,
    recordId: log.recordId,
    recordLabel: log.recordLabel,
    ipAddress: log.ipAddress,
    createdAt: log.createdAt,
  };
}

// Read-only by design: there are no endpoints to edit or delete audit records.
export const listAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePaginationQuery(req.query as Record<string, unknown>);
  const parsed = filtersSchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  }
  const { module, action, actorId, from, to } = parsed.data;

  const filter: QueryFilter<IAuditLog> = { organizationId: req.orgFilter!.organizationId };
  if (module) filter.module = module;
  if (action) filter.action = action;
  if (actorId) filter.actorId = actorId;
  if (from || to) {
    filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  }

  // Newest first. _id rather than createdAt: records are append-only, and ObjectIds
  // keep insertion order even for writes in the same millisecond.
  const { items, total } = await auditLogRepository.paginate({ filter, skip, limit, sortBy: '_id', sortDir: -1 });
  res.status(200).json(successResponse(items.map(serialize), { page, limit, total }));
});
