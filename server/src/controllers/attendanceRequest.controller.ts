import { Request, Response } from 'express';
import { QueryFilter, Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { AttendanceRequestModel, IAttendanceRequest } from '../models/attendanceRequest.model';
import { UserModel } from '../models/user.model';
import { userRepository } from '../repositories/user.repository';
import { auditCrud } from '../services/audit.service';
import { daysFor, DayView } from '../services/attendance.service';
import {
  approveRequest,
  canCancelRequest,
  cancelRequest,
  describeRequest,
  recordFix,
  rejectRequest,
  requestFix,
  requestWfh,
} from '../services/attendanceRequest.service';
import { mailerService } from '../services/mailer.service';
import { formatDates, notify } from '../services/notification.service';
import { activeMembers, departmentNameMap, toPerson } from '../services/people.service';
import { listAttendanceRequestsQuerySchema, teamDayQuerySchema, teamMonthQuerySchema } from '../validators/attendance.validators';
import { successResponse, ApiError } from '../utils/apiResponse';
import { parsePaginationQuery } from '../utils/pagination';
import { eachDate, monthRange, now, todayIso } from '../utils/dates';

function parseQuery<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { flatten: () => unknown } } }, query: unknown): T {
  const parsed = schema.safeParse(query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  return parsed.data;
}

/** Names of everyone a set of requests mentions (deleted people included). */
async function namesFor(requests: IAttendanceRequest[]): Promise<Map<string, string>> {
  const ids = [...new Set(requests.flatMap((r) => [r.employeeId, r.decidedBy, r.createdBy].filter(Boolean).map(String)))];
  const users = ids.length ? await UserModel.find({ _id: { $in: ids } }, { name: 1 }) : [];
  return new Map(users.map((u) => [String(u._id), u.name]));
}

function serialize(r: IAttendanceRequest, names: Map<string, string>, today: string) {
  return {
    id: String(r._id),
    employeeId: String(r.employeeId),
    employeeName: names.get(String(r.employeeId)) ?? null,
    kind: r.kind,
    startDate: r.startDate,
    endDate: r.endDate,
    clockIn: r.clockIn,
    clockOut: r.clockOut,
    reason: r.reason,
    status: r.status,
    decidedByName: r.decidedBy ? (names.get(String(r.decidedBy)) ?? null) : null,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    /** Set when an ORG_ADMIN recorded this fix for the employee. */
    recordedByName: r.createdBy && String(r.createdBy) !== String(r.employeeId) ? (names.get(String(r.createdBy)) ?? null) : null,
    createdAt: r.createdAt,
    canCancel: canCancelRequest(r, today),
  };
}

async function serializeOne(r: IAttendanceRequest) {
  return serialize(r, await namesFor([r]), todayIso(now()));
}

// ---------------------------------------------------------------- mine

export const createAttendanceRequest = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const at = now();
  const today = todayIso(at);
  const { kind, reason } = req.body;
  const request =
    kind === 'regularization'
      ? await requestFix(organizationId, req.user!.id, { date: req.body.date, clockIn: req.body.clockIn, clockOut: req.body.clockOut, reason }, today, at)
      : await requestWfh(organizationId, req.user!.id, { startDate: req.body.startDate, endDate: req.body.endDate, reason }, today);
  const summary = describeRequest(request);
  await auditCrud(req, 'create', 'attendance', { id: String(request._id), label: `Requested ${summary}` });

  const admins = await userRepository.find({ organizationId, role: 'ORG_ADMIN', status: 'active' });
  for (const admin of admins) {
    await mailerService.sendAttendanceRequestedEmail(admin.email, { employeeName: req.user!.name ?? 'An employee', summary, reason: request.reason });
  }
  const isFix = request.kind === 'regularization';
  await notify(
    organizationId,
    admins.map((a) => a._id as Types.ObjectId),
    {
      type: 'attendance_requested',
      title: `${req.user!.name ?? 'An employee'} ${isFix ? 'asked for an attendance fix' : 'asked to work from home'}`,
      body: isFix ? `${formatDates(request.startDate)} · ${request.clockIn}–${request.clockOut}` : formatDates(request.startDate, request.endDate),
      link: `/leave/approvals?tab=${isFix ? 'fixes' : 'wfh'}`,
    },
    req.user!.id
  );
  res.status(201).json(successResponse(await serializeOne(request)));
});

export const myAttendanceRequests = asyncHandler(async (req: Request, res: Response) => {
  const requests = await AttendanceRequestModel.find({
    organizationId: req.orgFilter!.organizationId,
    employeeId: new Types.ObjectId(req.user!.id),
    isDeleted: false,
  }).sort({ startDate: -1, createdAt: -1 });
  const names = await namesFor(requests);
  const today = todayIso(now());
  res.status(200).json(successResponse(requests.map((r) => serialize(r, names, today))));
});

export const cancelMyAttendanceRequest = asyncHandler(async (req: Request, res: Response) => {
  const updated = await cancelRequest(req.orgFilter!.organizationId, req.params.id, req.user!.id, todayIso(now()));
  await auditCrud(req, 'update', 'attendance', { id: req.params.id, label: `Cancelled ${describeRequest(updated)}` });
  res.status(200).json(successResponse(await serializeOne(updated)));
});

// ---------------------------------------------------------------- admin

export const listAttendanceRequests = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePaginationQuery(req.query as Record<string, unknown>);
  const { kind, status, employeeId } = parseQuery(listAttendanceRequestsQuerySchema, req.query);
  const filter: QueryFilter<IAttendanceRequest> = { organizationId: req.orgFilter!.organizationId, isDeleted: false };
  if (kind) filter.kind = kind;
  if (status) filter.status = status;
  if (employeeId) filter.employeeId = new Types.ObjectId(employeeId);
  // Pending: oldest first (first come, first served). Otherwise newest first.
  const sort = status === 'pending' ? 1 : -1;
  const [items, total] = await Promise.all([
    AttendanceRequestModel.find(filter).sort({ createdAt: sort, _id: sort }).skip(skip).limit(limit),
    AttendanceRequestModel.countDocuments(filter),
  ]);
  const names = await namesFor(items);
  const today = todayIso(now());
  res.status(200).json(successResponse(items.map((r) => serialize(r, names, today)), { page, limit, total }));
});

export const attendancePendingCount = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const [regularization, wfh] = await Promise.all([
    AttendanceRequestModel.countDocuments({ organizationId, kind: 'regularization', status: 'pending', isDeleted: false }),
    AttendanceRequestModel.countDocuments({ organizationId, kind: 'wfh', status: 'pending', isDeleted: false }),
  ]);
  res.status(200).json(successResponse({ regularization, wfh, total: regularization + wfh }));
});

function decide(action: 'approve' | 'reject') {
  return asyncHandler(async (req: Request, res: Response) => {
    const organizationId = req.orgFilter!.organizationId;
    const note: string = req.body.note ?? '';
    const updated =
      action === 'approve'
        ? await approveRequest(organizationId, req.params.id, req.user!.id, note)
        : await rejectRequest(organizationId, req.params.id, req.user!.id, note);
    const summary = describeRequest(updated);
    await auditCrud(req, 'update', 'attendance', { id: req.params.id, label: `${action === 'approve' ? 'Approved' : 'Rejected'} ${summary}` });
    const employee = await userRepository.findById(updated.employeeId);
    if (employee) {
      await mailerService.sendAttendanceDecisionEmail(employee.email, {
        status: updated.status as 'approved' | 'rejected',
        summary,
        note: updated.decisionNote,
        adminName: req.user!.name ?? 'Your admin',
      });
    }
    await notify(
      organizationId,
      [updated.employeeId],
      {
        type: 'attendance_decided',
        title: `Your ${updated.kind === 'regularization' ? 'attendance fix' : 'work-from-home request'} was ${updated.status}`,
        body: [formatDates(updated.startDate, updated.endDate), updated.decisionNote ? `“${updated.decisionNote}”` : null].filter(Boolean).join(' · '),
        link: '/me/attendance',
      },
      req.user!.id
    );
    res.status(200).json(successResponse(await serializeOne(updated)));
  });
}

export const approveAttendanceRequest = decide('approve');
export const rejectAttendanceRequest = decide('reject');

/** ORG_ADMIN fixes someone's day directly (approved straight away). */
export const recordAttendanceFix = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const employee = await userRepository.findById(req.body.employeeId, { organizationId, status: 'active', role: { $in: ['ORG_ADMIN', 'ORG_USER'] } });
  if (!employee) throw new ApiError(404, 'Employee not found', { fieldErrors: { employeeId: ['Choose an active employee'] } });
  const at = now();
  const { date, clockIn, clockOut, reason } = req.body;
  const request = await recordFix(organizationId, employee._id, req.user!.id, { date, clockIn, clockOut, reason }, todayIso(at), at);
  const summary = describeRequest(request);
  await auditCrud(req, 'create', 'attendance', { id: String(request._id), label: `Recorded ${summary} for ${employee.name}` });
  if (String(employee._id) !== req.user!.id) {
    await mailerService.sendAttendanceDecisionEmail(employee.email, { status: 'recorded', summary, note: reason, adminName: req.user!.name ?? 'Your admin' });
  }
  await notify(
    organizationId,
    [employee._id as Types.ObjectId],
    {
      type: 'attendance_recorded',
      title: `${req.user!.name ?? 'Your admin'} fixed your attendance`,
      body: `${formatDates(request.startDate)} · ${request.clockIn}–${request.clockOut}`,
      link: '/me/attendance',
    },
    req.user!.id
  );
  res.status(201).json(successResponse(await serializeOne(request)));
});

// ---------------------------------------------------------------- team

/** Active members, optionally in one department, by name. */
async function teamMembers(organizationId: Types.ObjectId, departmentId: string | undefined) {
  const [members, departmentNames] = await Promise.all([activeMembers(organizationId), departmentNameMap(organizationId)]);
  const people = members
    .filter((m) => !departmentId || String(m.department) === departmentId)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { people, departmentNames };
}

/** Everyone's status on one day (default: today). */
export const teamDay = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const { date: asked, departmentId } = parseQuery(teamDayQuerySchema, req.query);
  const at = now();
  const date = asked ?? todayIso(at);
  const { people, departmentNames } = await teamMembers(organizationId, departmentId);
  const days = await daysFor(organizationId, people.map((p) => p._id as Types.ObjectId), date, date, at);
  const rows = people.map((p) => ({ person: toPerson(p, departmentNames), day: days.get(String(p._id))![0] }));
  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.day.status]: (acc[r.day.status] ?? 0) + 1 }), {});
  res.status(200).json(successResponse({ date, rows, counts, late: rows.filter((r) => r.day.late).length, wfh: rows.filter((r) => r.day.wfh).length }));
});

/** A people × days grid for a month. */
export const teamMonth = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const { month: asked, departmentId } = parseQuery(teamMonthQuerySchema, req.query);
  const at = now();
  const month = asked ?? todayIso(at).slice(0, 7);
  const { from, to } = monthRange(month);
  const { people, departmentNames } = await teamMembers(organizationId, departmentId);
  const days = await daysFor(organizationId, people.map((p) => p._id as Types.ObjectId), from, to, at);
  const cell = (d: DayView) => ({ date: d.date, status: d.status, late: d.late, wfh: d.wfh, workedMinutes: d.workedMinutes });
  res.status(200).json(
    successResponse({
      month,
      dates: eachDate(from, to),
      rows: people.map((p) => ({ person: toPerson(p, departmentNames), days: days.get(String(p._id))!.map(cell) })),
    })
  );
});
