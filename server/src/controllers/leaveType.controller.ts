import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { ILeaveType } from '../models/leaveType.model';
import { LeaveRequestModel } from '../models/leaveRequest.model';
import { leaveTypeRepository } from '../repositories/leaveType.repository';
import { auditCrud } from '../services/audit.service';
import { ensureDefaultLeaveTypes } from '../services/leave.service';
import { successResponse, ApiError } from '../utils/apiResponse';
import { todayIso } from '../utils/dates';

function serialize(t: ILeaveType) {
  return {
    id: String(t._id),
    name: t.name,
    code: t.code,
    isPaid: t.isPaid,
    yearlyQuota: t.yearlyQuota,
    allowHalfDay: t.allowHalfDay,
    isActive: t.isActive,
  };
}

function codeTakenError(): ApiError {
  return new ApiError(400, 'Validation failed', { fieldErrors: { code: ['Another leave type already uses this code'] } });
}

async function assertCodeFree(organizationId: Types.ObjectId, code: string, exceptId?: string): Promise<void> {
  const clash = await leaveTypeRepository.findOne({ organizationId, code, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });
  if (clash) throw codeTakenError();
}

/** Active types for everyone; `?all=true` gives an ORG_ADMIN the inactive ones too. */
export const listLeaveTypes = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  await ensureDefaultLeaveTypes(organizationId);
  const includeInactive = req.query.all === 'true' && req.user!.role === 'ORG_ADMIN';
  const types = await leaveTypeRepository.find({ organizationId, ...(includeInactive ? {} : { isActive: true }) });
  types.sort((a, b) => a.name.localeCompare(b.name));
  res.status(200).json(successResponse(types.map(serialize)));
});

export const createLeaveType = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  await ensureDefaultLeaveTypes(organizationId);
  await assertCodeFree(organizationId, req.body.code);
  const type = await leaveTypeRepository.create({ organizationId, ...req.body }, req.user!.id);
  await auditCrud(req, 'create', 'leave', { id: String(type._id), label: `Leave type ${type.name} (${type.code})` });
  res.status(201).json(successResponse(serialize(type)));
});

export const updateLeaveType = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const existing = await leaveTypeRepository.findById(req.params.id, { organizationId });
  if (!existing) throw new ApiError(404, 'Leave type not found');
  if (req.body.code && req.body.code !== existing.code) {
    await assertCodeFree(organizationId, req.body.code, req.params.id);
  }
  const updated = await leaveTypeRepository.updateById(req.params.id, req.body, req.user!.id);
  await auditCrud(req, 'update', 'leave', { id: req.params.id, label: `Leave type ${updated!.name} (${updated!.code})` });
  res.status(200).json(successResponse(serialize(updated!)));
});

/** Refused while the type has pending or approved leave this year; deactivate it instead. */
export const deleteLeaveType = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const existing = await leaveTypeRepository.findById(req.params.id, { organizationId });
  if (!existing) throw new ApiError(404, 'Leave type not found');
  const year = todayIso().slice(0, 4);
  const inUse = await LeaveRequestModel.countDocuments({
    organizationId,
    leaveTypeId: existing._id,
    status: { $in: ['pending', 'approved'] },
    startDate: { $gte: `${year}-01-01` },
  });
  if (inUse > 0) {
    throw new ApiError(400, 'This leave type is used by pending or approved leave. Deactivate it instead.');
  }
  await leaveTypeRepository.softDelete(req.params.id, req.user!.id);
  await auditCrud(req, 'delete', 'leave', { id: req.params.id, label: `Leave type ${existing.name} (${existing.code})` });
  res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});
