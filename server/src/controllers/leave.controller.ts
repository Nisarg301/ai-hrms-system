import { Request, Response } from 'express';
import { QueryFilter, Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { ILeaveRequest, LeaveRequestModel } from '../models/leaveRequest.model';
import { LeaveTypeModel } from '../models/leaveType.model';
import { UserModel } from '../models/user.model';
import { userRepository } from '../repositories/user.repository';
import { leaveRequestRepository } from '../repositories/leaveRequest.repository';
import { auditCrud } from '../services/audit.service';
import { mailerService } from '../services/mailer.service';
import { days, formatDates, notify } from '../services/notification.service';
import {
  applyForLeave,
  approveLeave,
  MAX_BACKDATE_DAYS,
  recordLeave,
  balances,
  canCancel,
  cancelLeave,
  checkRequest,
  rejectLeave,
  usedDays,
} from '../services/leave.service';
import { balancesQuerySchema, listLeaveQuerySchema, previewLeaveQuerySchema, yearQuerySchema } from '../validators/leave.validators';
import { successResponse, ApiError } from '../utils/apiResponse';
import { parsePaginationQuery } from '../utils/pagination';
import { todayIso } from '../utils/dates';

function parseQuery<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { flatten: () => unknown } } }, query: unknown): T {
  const parsed = schema.safeParse(query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  return parsed.data;
}

function currentYear(): number {
  return Number(todayIso().slice(0, 4));
}

/** Names for the types and people referenced by a set of requests (deleted ones included). */
async function lookups(requests: ILeaveRequest[]) {
  const typeIds = [...new Set(requests.map((r) => String(r.leaveTypeId)))];
  const userIds = [
    ...new Set(requests.flatMap((r) => [String(r.employeeId), ...(r.decidedBy ? [String(r.decidedBy)] : []), ...(r.createdBy ? [String(r.createdBy)] : [])])),
  ];
  const [types, users] = await Promise.all([
    typeIds.length ? LeaveTypeModel.find({ _id: { $in: typeIds } }) : [],
    userIds.length ? UserModel.find({ _id: { $in: userIds } }, { name: 1 }) : [],
  ]);
  return {
    types: new Map(types.map((t) => [String(t._id), t])),
    names: new Map(users.map((u) => [String(u._id), u.name])),
  };
}

function serialize(r: ILeaveRequest, lookup: Awaited<ReturnType<typeof lookups>>, today: string) {
  const type = lookup.types.get(String(r.leaveTypeId));
  return {
    id: String(r._id),
    employeeId: String(r.employeeId),
    employeeName: lookup.names.get(String(r.employeeId)) ?? null,
    leaveTypeId: String(r.leaveTypeId),
    leaveTypeName: type?.name ?? null,
    leaveTypeCode: type?.code ?? null,
    isPaid: type?.isPaid ?? null,
    startDate: r.startDate,
    endDate: r.endDate,
    halfDay: r.halfDay,
    days: r.days,
    reason: r.reason,
    status: r.status,
    decidedByName: r.decidedBy ? (lookup.names.get(String(r.decidedBy)) ?? null) : null,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    /** Set when an ORG_ADMIN recorded this leave for the employee. */
    recordedByName: r.createdBy && String(r.createdBy) !== String(r.employeeId) ? (lookup.names.get(String(r.createdBy)) ?? null) : null,
    createdAt: r.createdAt,
    canCancel: canCancel(r, today),
  };
}

async function serializeOne(r: ILeaveRequest) {
  return serialize(r, await lookups([r]), todayIso());
}

function label(r: ILeaveRequest, code: string | null | undefined, what: string): string {
  const when = r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`;
  return `${what} ${code ?? 'leave'} ${when} (${r.days}d)`;
}

/**
 * Whose leave a request is about: the caller's own, or (ORG_ADMIN only) another
 * active member of the organization.
 */
async function targetEmployee(req: Request, employeeId: string | undefined) {
  const organizationId = req.orgFilter!.organizationId;
  const isSomeoneElse = Boolean(employeeId) && employeeId !== req.user!.id;
  if (isSomeoneElse && req.user!.role !== 'ORG_ADMIN') {
    throw new ApiError(403, 'Organization Admin access required');
  }
  const employee = await userRepository.findById(employeeId ?? req.user!.id, {
    organizationId,
    status: 'active',
    role: { $in: ['ORG_ADMIN', 'ORG_USER'] },
  });
  if (!employee) {
    throw new ApiError(404, 'Employee not found', { fieldErrors: { employeeId: ['Choose an active employee'] } });
  }
  return { employee, isSomeoneElse };
}

// ---------------------------------------------------------------- mine

/** My balances, or (ORG_ADMIN) someone else's with ?employeeId=. */
export const myBalances = asyncHandler(async (req: Request, res: Response) => {
  const { year, employeeId } = parseQuery(balancesQuerySchema, req.query);
  const { employee } = await targetEmployee(req, employeeId);
  const result = await balances(req.orgFilter!.organizationId, employee._id, year ?? currentYear());
  res.status(200).json(successResponse(result));
});

/**
 * The same checks as applying, without saving: powers the live day count in the
 * form. With ?employeeId= (ORG_ADMIN) it checks a recording for that employee.
 */
export const previewLeave = asyncHandler(async (req: Request, res: Response) => {
  const { employeeId, ...input } = parseQuery(previewLeaveQuerySchema, req.query);
  const { employee } = await targetEmployee(req, employeeId);
  // Only an ORG_ADMIN previewing a recording gets the recording rules (backdating).
  const options = employeeId && req.user!.role === 'ORG_ADMIN' ? { maxBackdateDays: MAX_BACKDATE_DAYS } : {};
  const { days, availableAfter } = await checkRequest(req.orgFilter!.organizationId, employee._id, input, todayIso(), options);
  res.status(200).json(successResponse({ days, availableAfter }));
});

export const myRequests = asyncHandler(async (req: Request, res: Response) => {
  const { year } = parseQuery(yearQuerySchema, req.query);
  const y = year ?? currentYear();
  const requests = await leaveRequestRepository.find({
    organizationId: req.orgFilter!.organizationId,
    employeeId: new Types.ObjectId(req.user!.id),
    startDate: { $gte: `${y}-01-01`, $lte: `${y}-12-31` },
  });
  requests.sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.getTime() - a.createdAt.getTime());
  const lookup = await lookups(requests);
  const today = todayIso();
  res.status(200).json(successResponse(requests.map((r) => serialize(r, lookup, today))));
});

export const applyLeave = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const { request, leaveType } = await applyForLeave(organizationId, req.user!.id, req.body, todayIso());
  await auditCrud(req, 'create', 'leave', { id: String(request._id), label: label(request, leaveType.code, 'Applied for') });

  const [employee, admins] = await Promise.all([
    userRepository.findById(req.user!.id),
    userRepository.find({ organizationId, role: 'ORG_ADMIN', status: 'active' }),
  ]);
  for (const admin of admins) {
    await mailerService.sendLeaveRequestedEmail(admin.email, {
      employeeName: employee?.name ?? 'An employee',
      typeName: leaveType.name,
      startDate: request.startDate,
      endDate: request.endDate,
      days: request.days,
      reason: request.reason,
    });
  }
  await notify(
    organizationId,
    admins.map((a) => a._id as Types.ObjectId),
    {
      type: 'leave_requested',
      title: `${employee?.name ?? 'An employee'} applied for ${leaveType.name}`,
      body: `${formatDates(request.startDate, request.endDate)} · ${days(request.days)}`,
      link: '/leave/approvals',
    },
    req.user!.id
  );
  res.status(201).json(successResponse(await serializeOne(request)));
});

/** ORG_ADMIN records leave for an employee (e.g. an emergency); it's approved straight away. */
export const recordLeaveRequest = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const { employeeId, ...input } = req.body;
  const { employee } = await targetEmployee(req, employeeId);
  const { request, leaveType } = await recordLeave(organizationId, employee._id, req.user!.id, input, todayIso());
  await auditCrud(req, 'create', 'leave', { id: String(request._id), label: `${label(request, leaveType.code, 'Recorded')} for ${employee.name}` });

  // Tell the employee, unless the admin recorded their own leave.
  if (String(employee._id) !== req.user!.id) {
    await mailerService.sendLeaveRecordedEmail(employee.email, {
      adminName: req.user!.name ?? 'Your admin',
      typeName: leaveType.name,
      startDate: request.startDate,
      endDate: request.endDate,
      days: request.days,
      reason: request.reason,
    });
  }
  await notify(
    organizationId,
    [employee._id as Types.ObjectId],
    {
      type: 'leave_recorded',
      title: `${req.user!.name ?? 'Your admin'} recorded ${leaveType.name} for you`,
      body: `${formatDates(request.startDate, request.endDate)} · ${days(request.days)} · approved`,
      link: '/me/leave',
    },
    req.user!.id
  );
  res.status(201).json(successResponse(await serializeOne(request)));
});

export const cancelMyLeave = asyncHandler(async (req: Request, res: Response) => {
  const updated = await cancelLeave(req.orgFilter!.organizationId, req.params.id, req.user!.id, todayIso());
  const type = await LeaveTypeModel.findById(updated.leaveTypeId);
  await auditCrud(req, 'update', 'leave', { id: req.params.id, label: label(updated, type?.code, 'Cancelled') });
  res.status(200).json(successResponse(await serializeOne(updated)));
});

// ---------------------------------------------------------------- admin

export const listLeaveRequests = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePaginationQuery(req.query as Record<string, unknown>);
  const { status, employeeId, from, to } = parseQuery(listLeaveQuerySchema, req.query);
  const organizationId = req.orgFilter!.organizationId;

  const filter: QueryFilter<ILeaveRequest> = { organizationId };
  if (status) filter.status = status;
  if (employeeId) filter.employeeId = new Types.ObjectId(employeeId);
  // Any request overlapping [from, to].
  if (from) filter.endDate = { $gte: from };
  if (to) filter.startDate = { $lte: to };

  // Pending: oldest first (first come, first served). Otherwise newest first.
  const sortDir = status === 'pending' ? 1 : -1;
  const { items, total } = await leaveRequestRepository.paginate({ filter, skip, limit, sortBy: 'createdAt', sortDir });
  const lookup = await lookups(items);
  const today = todayIso();

  const data = await Promise.all(
    items.map(async (r) => {
      const row = serialize(r, lookup, today);
      const type = lookup.types.get(String(r.leaveTypeId));
      // What would be left if this pending request were approved (null = unlimited).
      let availableAfter: number | null = null;
      if (r.status === 'pending' && type?.yearlyQuota != null) {
        const used = await usedDays(organizationId, r.employeeId, r.leaveTypeId, Number(r.startDate.slice(0, 4)), r._id as Types.ObjectId);
        availableAfter = type.yearlyQuota - used.approved - used.pending - r.days;
      }
      return { ...row, availableAfter };
    })
  );
  res.status(200).json(successResponse(data, { page, limit, total }));
});

export const pendingCount = asyncHandler(async (req: Request, res: Response) => {
  const count = await LeaveRequestModel.countDocuments({ organizationId: req.orgFilter!.organizationId, status: 'pending' });
  res.status(200).json(successResponse({ count }));
});

function decide(action: 'approve' | 'reject') {
  return asyncHandler(async (req: Request, res: Response) => {
    const organizationId = req.orgFilter!.organizationId;
    const note: string = req.body.note ?? '';
    const updated =
      action === 'approve'
        ? await approveLeave(organizationId, req.params.id, req.user!.id, note)
        : await rejectLeave(organizationId, req.params.id, req.user!.id, note);
    const type = await LeaveTypeModel.findById(updated.leaveTypeId);
    await auditCrud(req, 'update', 'leave', { id: req.params.id, label: label(updated, type?.code, action === 'approve' ? 'Approved' : 'Rejected') });

    const employee = await userRepository.findById(updated.employeeId);
    if (employee) {
      await mailerService.sendLeaveDecisionEmail(employee.email, {
        status: updated.status as 'approved' | 'rejected',
        typeName: type?.name ?? 'leave',
        startDate: updated.startDate,
        endDate: updated.endDate,
        days: updated.days,
        note: updated.decisionNote,
      });
    }
    await notify(
      organizationId,
      [updated.employeeId],
      {
        type: 'leave_decided',
        title: `Your ${type?.name ?? 'leave'} was ${updated.status}`,
        body: [formatDates(updated.startDate, updated.endDate), updated.decisionNote ? `“${updated.decisionNote}”` : null].filter(Boolean).join(' · '),
        link: '/me/leave',
      },
      req.user!.id
    );
    res.status(200).json(successResponse(await serializeOne(updated)));
  });
}

export const approveLeaveRequest = decide('approve');
export const rejectLeaveRequest = decide('reject');
