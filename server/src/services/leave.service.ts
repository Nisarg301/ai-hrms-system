import { Types } from 'mongoose';
import { ILeaveType, LeaveTypeModel } from '../models/leaveType.model';
import { HalfDay, ILeaveRequest, LeaveRequestModel, LeaveStatus } from '../models/leaveRequest.model';
import { leaveTypeRepository } from '../repositories/leaveType.repository';
import { holidayService } from './holiday.service';
import { ApiError } from '../utils/apiResponse';
import { addDays, eachDate, isWeekend } from '../utils/dates';

type OrgId = Types.ObjectId | string;
const oid = (id: OrgId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

/**
 * How far back an ORG_ADMIN can record leave for someone (spec default 9). People
 * applying for themselves can't go back at all: their leave starts today or later.
 */
export const MAX_BACKDATE_DAYS = 30;

export interface CheckOptions {
  /** 0 for your own application (default); MAX_BACKDATE_DAYS when an ORG_ADMIN records it. */
  maxBackdateDays?: number;
}

/** Pending and approved requests hold days; rejected and cancelled don't. */
const ACTIVE_STATUSES: LeaveStatus[] = ['pending', 'approved'];

function fieldError(field: string, message: string): ApiError {
  return new ApiError(400, message, { fieldErrors: { [field]: [message] } });
}

// ---------------------------------------------------------------- leave types

/** The two types every organization starts with (spec default 5). */
const DEFAULT_TYPES = [
  { name: 'Paid Leave', code: 'PL', isPaid: true, yearlyQuota: 12, allowHalfDay: true },
  { name: 'Unpaid Leave', code: 'UL', isPaid: false, yearlyQuota: null, allowHalfDay: true },
];

/**
 * Creates the default types the first time an organization's leave is used.
 * Only when it has never had any (deleted ones count), so an admin who removed
 * them doesn't see them come back. Safe under concurrent first calls: the
 * unique code index turns the loser's insert into a harmless duplicate error.
 */
export async function ensureDefaultLeaveTypes(organizationId: OrgId): Promise<void> {
  const org = oid(organizationId);
  if ((await LeaveTypeModel.countDocuments({ organizationId: org })) > 0) return;
  try {
    await LeaveTypeModel.insertMany(DEFAULT_TYPES.map((t) => ({ ...t, organizationId: org })), { ordered: false });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
  }
}

// ---------------------------------------------------------------- counting

/** Working days in [from, to]: Saturdays, Sundays and the organization's holidays don't count. */
export async function workingDates(organizationId: OrgId, from: string, to: string): Promise<string[]> {
  const holidays = await holidayService.datesBetween(organizationId, from, to);
  return eachDate(from, to).filter((d) => !isWeekend(d) && !holidays.has(d));
}

/** Leave days for a request: working days, or 0.5 for a half day on a working day. */
export async function countLeaveDays(organizationId: OrgId, from: string, to: string, halfDay: HalfDay | null): Promise<number> {
  const working = await workingDates(organizationId, from, to);
  if (halfDay) return working.length === 1 ? 0.5 : 0;
  return working.length;
}

/** Approved and pending days of one type in a calendar year (pending ones reserve days). */
export async function usedDays(
  organizationId: OrgId,
  employeeId: OrgId,
  leaveTypeId: OrgId,
  year: number,
  excludeRequestId?: OrgId
): Promise<{ approved: number; pending: number }> {
  const match: Record<string, unknown> = {
    organizationId: oid(organizationId),
    employeeId: oid(employeeId),
    leaveTypeId: oid(leaveTypeId),
    status: { $in: ACTIVE_STATUSES },
    startDate: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
  };
  if (excludeRequestId) match._id = { $ne: oid(excludeRequestId) };
  const rows = await LeaveRequestModel.aggregate<{ _id: LeaveStatus; days: number }>([
    { $match: match },
    { $group: { _id: '$status', days: { $sum: '$days' } } },
  ]);
  return {
    approved: rows.find((r) => r._id === 'approved')?.days ?? 0,
    pending: rows.find((r) => r._id === 'pending')?.days ?? 0,
  };
}

export interface Balance {
  leaveTypeId: string;
  name: string;
  code: string;
  isPaid: boolean;
  allowHalfDay: boolean;
  yearlyQuota: number | null;
  approved: number;
  pending: number;
  /** null = unlimited. */
  available: number | null;
}

/** One employee's balance for every active type in a year. */
export async function balances(organizationId: OrgId, employeeId: OrgId, year: number): Promise<Balance[]> {
  await ensureDefaultLeaveTypes(organizationId);
  const types = await leaveTypeRepository.find({ organizationId: oid(organizationId), isActive: true });
  types.sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(
    types.map(async (t) => {
      const used = await usedDays(organizationId, employeeId, t._id as Types.ObjectId, year);
      return {
        leaveTypeId: String(t._id),
        name: t.name,
        code: t.code,
        isPaid: t.isPaid,
        allowHalfDay: t.allowHalfDay,
        yearlyQuota: t.yearlyQuota,
        approved: used.approved,
        pending: used.pending,
        available: t.yearlyQuota === null ? null : t.yearlyQuota - used.approved - used.pending,
      };
    })
  );
}

// ---------------------------------------------------------------- applying

export interface LeaveInput {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  halfDay: HalfDay | null;
}

/**
 * Every rule a new request must pass, without saving anything (also powers the
 * live preview). Returns the type, the day count and what's left afterwards.
 */
export async function checkRequest(
  organizationId: OrgId,
  employeeId: OrgId,
  input: LeaveInput,
  today: string,
  options: CheckOptions = {}
): Promise<{ leaveType: ILeaveType; days: number; availableAfter: number | null }> {
  const maxBackdateDays = options.maxBackdateDays ?? 0;
  const leaveType = Types.ObjectId.isValid(input.leaveTypeId)
    ? await leaveTypeRepository.findById(input.leaveTypeId, { organizationId: oid(organizationId), isActive: true })
    : null;
  if (!leaveType) throw fieldError('leaveTypeId', 'Choose a valid leave type');

  const { startDate, endDate, halfDay } = input;
  if (startDate > endDate) throw fieldError('endDate', 'The end date is before the start date');
  if (startDate.slice(0, 4) !== endDate.slice(0, 4)) {
    throw fieldError('endDate', 'Leave must stay within one calendar year. Apply for each year separately.');
  }
  if (startDate < addDays(today, -maxBackdateDays)) {
    throw fieldError(
      'startDate',
      maxBackdateDays === 0
        ? "Leave can't start before today. For an emergency, ask your admin to record it for you."
        : `Leave can be recorded for at most ${maxBackdateDays} days in the past`
    );
  }
  if (halfDay) {
    if (startDate !== endDate) throw fieldError('halfDay', 'A half day must be a single date');
    if (!leaveType.allowHalfDay) throw fieldError('halfDay', `${leaveType.name} can't be taken as a half day`);
  }

  const days = await countLeaveDays(organizationId, startDate, endDate, halfDay);
  if (days === 0) throw fieldError('startDate', 'The selected dates are all weekends or holidays');

  const overlap = await LeaveRequestModel.findOne({
    organizationId: oid(organizationId),
    employeeId: oid(employeeId),
    status: { $in: ACTIVE_STATUSES },
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  });
  if (overlap) {
    const when = overlap.startDate === overlap.endDate ? overlap.startDate : `${overlap.startDate} to ${overlap.endDate}`;
    throw fieldError('startDate', `This overlaps your ${overlap.status} leave on ${when}`);
  }

  let availableAfter: number | null = null;
  if (leaveType.yearlyQuota !== null) {
    const used = await usedDays(organizationId, employeeId, leaveType._id as Types.ObjectId, Number(startDate.slice(0, 4)));
    const available = leaveType.yearlyQuota - used.approved - used.pending;
    if (days > available) {
      throw fieldError('leaveTypeId', `Only ${Math.max(available, 0)} day(s) of ${leaveType.name} left this year`);
    }
    availableAfter = available - days;
  }
  return { leaveType, days, availableAfter };
}

export async function applyForLeave(
  organizationId: OrgId,
  employeeId: OrgId,
  input: LeaveInput & { reason: string },
  today: string
): Promise<{ request: ILeaveRequest; leaveType: ILeaveType }> {
  const { leaveType, days } = await checkRequest(organizationId, employeeId, input, today);
  const request = await LeaveRequestModel.create({
    organizationId: oid(organizationId),
    employeeId: oid(employeeId),
    leaveTypeId: leaveType._id,
    startDate: input.startDate,
    endDate: input.endDate,
    halfDay: input.halfDay,
    days,
    reason: input.reason,
    status: 'pending',
    createdBy: oid(employeeId),
    updatedBy: oid(employeeId),
  });
  return { request, leaveType };
}

/**
 * An ORG_ADMIN records leave for someone (an emergency, say, when they couldn't
 * apply themselves). The same checks apply, except it may be backdated up to
 * MAX_BACKDATE_DAYS, and it's approved straight away.
 */
export async function recordLeave(
  organizationId: OrgId,
  employeeId: OrgId,
  adminId: string,
  input: LeaveInput & { reason: string },
  today: string
): Promise<{ request: ILeaveRequest; leaveType: ILeaveType }> {
  const { leaveType, days } = await checkRequest(organizationId, employeeId, input, today, { maxBackdateDays: MAX_BACKDATE_DAYS });
  const admin = oid(adminId);
  const request = await LeaveRequestModel.create({
    organizationId: oid(organizationId),
    employeeId: oid(employeeId),
    leaveTypeId: leaveType._id,
    startDate: input.startDate,
    endDate: input.endDate,
    halfDay: input.halfDay,
    days,
    reason: input.reason,
    status: 'approved',
    decidedBy: admin,
    decidedAt: new Date(),
    decisionNote: '',
    createdBy: admin,
    updatedBy: admin,
  });
  return { request, leaveType };
}

// ---------------------------------------------------------------- decisions

/**
 * Moves a request from `from` to `to` in one atomic update, so two admins (or an
 * admin and the employee cancelling) can't both act on the same request.
 */
async function transition(
  organizationId: OrgId,
  requestId: string,
  from: LeaveStatus[],
  set: Partial<Pick<ILeaveRequest, 'status' | 'decidedBy' | 'decidedAt' | 'decisionNote' | 'updatedBy'>>,
  extraFilter: Record<string, unknown> = {}
): Promise<ILeaveRequest> {
  const updated = await LeaveRequestModel.findOneAndUpdate(
    { _id: requestId, organizationId: oid(organizationId), status: { $in: from }, ...extraFilter },
    { $set: set },
    { returnDocument: 'after' }
  );
  if (updated) return updated;
  const current = await LeaveRequestModel.findOne({ _id: requestId, organizationId: oid(organizationId) });
  if (!current) throw new ApiError(404, 'Leave request not found');
  throw new ApiError(409, `This request is already ${current.status}`);
}

/** ORG_ADMIN approval. Re-checks the balance in case the quota was lowered since the request was made. */
export async function approveLeave(organizationId: OrgId, requestId: string, adminId: string, note: string): Promise<ILeaveRequest> {
  const request = await LeaveRequestModel.findOne({ _id: requestId, organizationId: oid(organizationId) });
  if (!request) throw new ApiError(404, 'Leave request not found');
  if (request.status === 'pending') {
    const leaveType = await LeaveTypeModel.findById(request.leaveTypeId);
    if (leaveType?.yearlyQuota != null) {
      const used = await usedDays(organizationId, request.employeeId, request.leaveTypeId, Number(request.startDate.slice(0, 4)), request._id as Types.ObjectId);
      const available = leaveType.yearlyQuota - used.approved - used.pending;
      if (request.days > available) {
        throw new ApiError(400, `Not enough ${leaveType.name} left: ${Math.max(available, 0)} day(s) available, ${request.days} requested`);
      }
    }
  }
  return transition(organizationId, requestId, ['pending'], {
    status: 'approved',
    decidedBy: new Types.ObjectId(adminId),
    decidedAt: new Date(),
    decisionNote: note,
    updatedBy: new Types.ObjectId(adminId),
  });
}

export function rejectLeave(organizationId: OrgId, requestId: string, adminId: string, note: string): Promise<ILeaveRequest> {
  return transition(organizationId, requestId, ['pending'], {
    status: 'rejected',
    decidedBy: new Types.ObjectId(adminId),
    decidedAt: new Date(),
    decisionNote: note,
    updatedBy: new Types.ObjectId(adminId),
  });
}

/** Whether the owner may still cancel: always while pending; approved only before it starts. */
export function canCancel(request: Pick<ILeaveRequest, 'status' | 'startDate'>, today: string): boolean {
  return request.status === 'pending' || (request.status === 'approved' && request.startDate > today);
}

/** The employee's own cancellation. */
export async function cancelLeave(organizationId: OrgId, requestId: string, employeeId: string, today: string): Promise<ILeaveRequest> {
  const request = await LeaveRequestModel.findOne({ _id: requestId, organizationId: oid(organizationId), employeeId: oid(employeeId) });
  if (!request) throw new ApiError(404, 'Leave request not found');
  if (request.status === 'approved' && request.startDate <= today) {
    throw new ApiError(400, "Leave that has already started can't be cancelled");
  }
  // For approved leave, re-assert "not started yet" inside the atomic update too.
  const from: LeaveStatus[] = request.status === 'approved' ? ['approved'] : ['pending'];
  const extra = request.status === 'approved' ? { startDate: { $gt: today } } : {};
  return transition(organizationId, requestId, from, { status: 'cancelled', updatedBy: new Types.ObjectId(employeeId) }, { employeeId: oid(employeeId), ...extra });
}

// ---------------------------------------------------------------- who's out

/** Approved leave covering `date`, if it's a working day (nobody is "on leave" on a Sunday). */
export async function onLeaveOn(organizationId: OrgId, date: string): Promise<ILeaveRequest[]> {
  if ((await workingDates(organizationId, date, date)).length === 0) return [];
  return LeaveRequestModel.find({
    organizationId: oid(organizationId),
    status: 'approved',
    startDate: { $lte: date },
    endDate: { $gte: date },
  });
}

/**
 * For each employee, the working dates in [from, to] they're on approved leave.
 * `employeeIds` limits it to a team; omit for the whole organization.
 */
export async function leaveDatesBetween(organizationId: OrgId, from: string, to: string, employeeIds?: string[]): Promise<Map<string, string[]>> {
  const requests = await LeaveRequestModel.find({
    organizationId: oid(organizationId),
    status: 'approved',
    startDate: { $lte: to },
    endDate: { $gte: from },
    ...(employeeIds ? { employeeId: { $in: employeeIds.map((id) => new Types.ObjectId(id)) } } : {}),
  });
  const working = new Set(await workingDates(organizationId, from, to));
  const result = new Map<string, string[]>();
  for (const r of requests) {
    const start = r.startDate > from ? r.startDate : from;
    const end = r.endDate < to ? r.endDate : to;
    const dates = eachDate(start, end).filter((d) => working.has(d));
    if (dates.length === 0) continue;
    const key = r.employeeId.toString();
    result.set(key, [...(result.get(key) ?? []), ...dates].sort());
  }
  return result;
}
