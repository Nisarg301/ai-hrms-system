import { Types } from 'mongoose';
import { AttendancePunchModel } from '../models/attendancePunch.model';
import { AttendanceRequestModel, AttendanceRequestStatus, IAttendanceRequest } from '../models/attendanceRequest.model';
import { LeaveRequestModel } from '../models/leaveRequest.model';
import { ApiError } from '../utils/apiResponse';
import { addDays, hmToMinutes, minutesOfDay, zonedInstant } from '../utils/dates';
import { workingDates } from './leave.service';

type OrgId = Types.ObjectId | string;
const oid = (id: OrgId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

/** How far back a fix can be asked for or recorded (spec default 5). */
export const MAX_FIX_BACKDATE_DAYS = 30;
/** How far back work from home can be asked for (spec default 6). */
export const MAX_WFH_BACKDATE_DAYS = 7;

function fieldError(field: string, message: string): ApiError {
  return new ApiError(400, message, { fieldErrors: { [field]: [message] } });
}

function when(r: Pick<IAttendanceRequest, 'startDate' | 'endDate'>): string {
  return r.startDate === r.endDate ? r.startDate : `${r.startDate} to ${r.endDate}`;
}

/** Audit / email wording: "Fix 2026-10-02 09:30–18:30" or "WFH 2026-10-07 to 2026-10-08". */
export function describeRequest(r: Pick<IAttendanceRequest, 'kind' | 'startDate' | 'endDate' | 'clockIn' | 'clockOut'>): string {
  return r.kind === 'regularization' ? `Fix ${r.startDate} ${r.clockIn}–${r.clockOut}` : `WFH ${when(r)}`;
}

export interface FixInput {
  date: string;
  clockIn: string;
  clockOut: string;
  reason: string;
}

export interface WfhInput {
  startDate: string;
  endDate: string;
  reason: string;
}

// ---------------------------------------------------------------- checks

async function fullDayLeaveOn(organizationId: Types.ObjectId, employeeId: Types.ObjectId, date: string) {
  return LeaveRequestModel.findOne({ organizationId, employeeId, status: { $in: ['pending', 'approved'] }, halfDay: null, startDate: { $lte: date }, endDate: { $gte: date } });
}

/** A fix: a date up to 30 days back (not the future), out after in, not on a day of full leave. */
async function checkFix(organizationId: Types.ObjectId, employeeId: Types.ObjectId, input: FixInput, today: string, at: Date) {
  if (input.date > today) throw fieldError('date', "You can't fix a day that hasn't happened yet");
  if (input.date < addDays(today, -MAX_FIX_BACKDATE_DAYS)) {
    throw fieldError('date', `Fixes can go back at most ${MAX_FIX_BACKDATE_DAYS} days`);
  }
  if (hmToMinutes(input.clockOut) <= hmToMinutes(input.clockIn)) throw fieldError('clockOut', 'Clock-out must be after clock-in');
  if (input.date === today && hmToMinutes(input.clockOut) > minutesOfDay(at)) {
    throw fieldError('clockOut', "Clock-out can't be later than now");
  }
  if (await fullDayLeaveOn(organizationId, employeeId, input.date)) {
    throw fieldError('date', "You're on leave that day, so there's nothing to fix");
  }
}

/** WFH: up to 7 days back, one calendar year, at least one working day, no overlap with WFH or leave. */
async function checkWfh(organizationId: Types.ObjectId, employeeId: Types.ObjectId, input: WfhInput, today: string) {
  const { startDate, endDate } = input;
  if (startDate > endDate) throw fieldError('endDate', 'The end date is before the start date');
  if (startDate.slice(0, 4) !== endDate.slice(0, 4)) throw fieldError('endDate', 'Keep it within one calendar year');
  if (startDate < addDays(today, -MAX_WFH_BACKDATE_DAYS)) {
    throw fieldError('startDate', `Work from home can be requested at most ${MAX_WFH_BACKDATE_DAYS} days back`);
  }
  if ((await workingDates(organizationId, startDate, endDate)).length === 0) {
    throw fieldError('startDate', 'The selected dates are all weekends or holidays');
  }
  const active: ('pending' | 'approved')[] = ['pending', 'approved'];
  const overlap = { organizationId, employeeId, status: { $in: active }, startDate: { $lte: endDate }, endDate: { $gte: startDate } };
  const wfh = await AttendanceRequestModel.findOne({ ...overlap, kind: 'wfh', isDeleted: false });
  if (wfh) throw fieldError('startDate', `This overlaps your ${wfh.status} work from home on ${when(wfh)}`);
  const leave = await LeaveRequestModel.findOne({ ...overlap, halfDay: null });
  if (leave) throw fieldError('startDate', `This overlaps your ${leave.status} leave on ${when(leave)}`);
}

// ---------------------------------------------------------------- creating

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number }).code === 11000;
}

export async function requestFix(organizationId: OrgId, employeeId: OrgId, input: FixInput, today: string, at: Date): Promise<IAttendanceRequest> {
  const org = oid(organizationId);
  const emp = oid(employeeId);
  await checkFix(org, emp, input, today, at);
  try {
    return await AttendanceRequestModel.create({
      organizationId: org,
      employeeId: emp,
      kind: 'regularization',
      startDate: input.date,
      endDate: input.date,
      clockIn: input.clockIn,
      clockOut: input.clockOut,
      reason: input.reason,
      createdBy: emp,
      updatedBy: emp,
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw fieldError('date', 'You already have a fix waiting for approval on this date');
    throw err;
  }
}

export async function requestWfh(organizationId: OrgId, employeeId: OrgId, input: WfhInput, today: string): Promise<IAttendanceRequest> {
  const org = oid(organizationId);
  const emp = oid(employeeId);
  await checkWfh(org, emp, input, today);
  return AttendanceRequestModel.create({
    organizationId: org,
    employeeId: emp,
    kind: 'wfh',
    startDate: input.startDate,
    endDate: input.endDate,
    reason: input.reason,
    createdBy: emp,
    updatedBy: emp,
  });
}

/** Replaces a day's punches with the corrected pair. */
async function applyFix(r: IAttendanceRequest, actorId: Types.ObjectId): Promise<void> {
  await AttendancePunchModel.updateMany(
    { organizationId: r.organizationId, employeeId: r.employeeId, date: r.startDate, isDeleted: false },
    { $set: { isDeleted: true, isOpen: false, deletedAt: new Date(), deletedBy: actorId } }
  );
  await AttendancePunchModel.create({
    organizationId: r.organizationId,
    employeeId: r.employeeId,
    date: r.startDate,
    clockIn: zonedInstant(r.startDate, r.clockIn!),
    clockOut: zonedInstant(r.startDate, r.clockOut!),
    isOpen: false,
    source: 'regularization',
    createdBy: actorId,
    updatedBy: actorId,
  });
}

/** An ORG_ADMIN records a fix for someone: approved straight away (like Record leave). */
export async function recordFix(organizationId: OrgId, employeeId: OrgId, adminId: string, input: FixInput, today: string, at: Date): Promise<IAttendanceRequest> {
  const org = oid(organizationId);
  const emp = oid(employeeId);
  const admin = oid(adminId);
  await checkFix(org, emp, input, today, at);
  // A pending fix for that date is superseded by the admin's.
  await AttendanceRequestModel.updateMany(
    { organizationId: org, employeeId: emp, kind: 'regularization', startDate: input.date, status: 'pending', isDeleted: false },
    { $set: { status: 'cancelled', updatedBy: admin } }
  );
  const request = await AttendanceRequestModel.create({
    organizationId: org,
    employeeId: emp,
    kind: 'regularization',
    startDate: input.date,
    endDate: input.date,
    clockIn: input.clockIn,
    clockOut: input.clockOut,
    reason: input.reason,
    status: 'approved',
    decidedBy: admin,
    decidedAt: new Date(),
    createdBy: admin,
    updatedBy: admin,
  });
  await applyFix(request, admin);
  return request;
}

// ---------------------------------------------------------------- decisions

async function transition(
  organizationId: Types.ObjectId,
  requestId: string,
  from: AttendanceRequestStatus[],
  set: Partial<Pick<IAttendanceRequest, 'status' | 'decidedBy' | 'decidedAt' | 'decisionNote' | 'updatedBy'>>,
  extraFilter: Record<string, unknown> = {}
): Promise<IAttendanceRequest> {
  const updated = await AttendanceRequestModel.findOneAndUpdate(
    { _id: requestId, organizationId, status: { $in: from }, isDeleted: false, ...extraFilter },
    { $set: set },
    { returnDocument: 'after' }
  );
  if (updated) return updated;
  const current = await AttendanceRequestModel.findOne({ _id: requestId, organizationId, isDeleted: false, ...extraFilter });
  if (!current) throw new ApiError(404, 'Request not found');
  throw new ApiError(409, `This request is already ${current.status}`);
}

export async function approveRequest(organizationId: OrgId, requestId: string, adminId: string, note: string): Promise<IAttendanceRequest> {
  const admin = oid(adminId);
  const approved = await transition(oid(organizationId), requestId, ['pending'], {
    status: 'approved',
    decidedBy: admin,
    decidedAt: new Date(),
    decisionNote: note,
    updatedBy: admin,
  });
  if (approved.kind === 'regularization') await applyFix(approved, admin);
  return approved;
}

export function rejectRequest(organizationId: OrgId, requestId: string, adminId: string, note: string): Promise<IAttendanceRequest> {
  const admin = oid(adminId);
  return transition(oid(organizationId), requestId, ['pending'], {
    status: 'rejected',
    decidedBy: admin,
    decidedAt: new Date(),
    decisionNote: note,
    updatedBy: admin,
  });
}

/** Mine: pending ones always; approved WFH only before it starts (an approved fix is done). */
export function canCancelRequest(r: Pick<IAttendanceRequest, 'kind' | 'status' | 'startDate'>, today: string): boolean {
  return r.status === 'pending' || (r.kind === 'wfh' && r.status === 'approved' && r.startDate > today);
}

export async function cancelRequest(organizationId: OrgId, requestId: string, employeeId: string, today: string): Promise<IAttendanceRequest> {
  const org = oid(organizationId);
  const emp = oid(employeeId);
  const r = await AttendanceRequestModel.findOne({ _id: requestId, organizationId: org, employeeId: emp, isDeleted: false });
  if (!r) throw new ApiError(404, 'Request not found');
  if (r.status === 'approved' && !canCancelRequest(r, today)) {
    throw new ApiError(400, r.kind === 'wfh' ? "Work from home that has already started can't be cancelled" : "An approved fix can't be cancelled");
  }
  const approvedWfh = r.status === 'approved';
  return transition(
    org,
    requestId,
    approvedWfh ? ['approved'] : ['pending'],
    { status: 'cancelled', updatedBy: emp },
    { employeeId: emp, ...(approvedWfh ? { kind: 'wfh', startDate: { $gt: today } } : {}) }
  );
}

// ---------------------------------------------------------------- lookups

/** Approved WFH dates per employee in [from, to], as "employeeId|date" keys. */
export async function approvedWfhKeys(organizationId: OrgId, employeeIds: Types.ObjectId[], from: string, to: string): Promise<Set<string>> {
  const requests = await AttendanceRequestModel.find({
    organizationId: oid(organizationId),
    employeeId: { $in: employeeIds },
    kind: 'wfh',
    status: 'approved',
    isDeleted: false,
    startDate: { $lte: to },
    endDate: { $gte: from },
  });
  const keys = new Set<string>();
  for (const r of requests) {
    for (let d = r.startDate > from ? r.startDate : from; d <= (r.endDate < to ? r.endDate : to); d = addDays(d, 1)) {
      keys.add(`${r.employeeId}|${d}`);
    }
  }
  return keys;
}
