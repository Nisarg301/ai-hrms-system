import { Types } from 'mongoose';
import { AttendancePunchModel, IAttendancePunch } from '../models/attendancePunch.model';
import { AttendanceSettingsModel, DEFAULT_ATTENDANCE_SETTINGS, IAttendanceSettings } from '../models/attendanceSettings.model';
import { HalfDay, LeaveRequestModel } from '../models/leaveRequest.model';
import { LeaveTypeModel } from '../models/leaveType.model';
import { UserModel } from '../models/user.model';
import { holidayRepository } from '../repositories/holiday.repository';
import { ApiError } from '../utils/apiResponse';
import { approvedWfhKeys } from './attendanceRequest.service';
import { effectiveJoiningDate } from './people.service';
import { eachDate, hmToMinutes, isWeekend, minutesOfDay, monthRange, now as currentInstant, todayIso } from '../utils/dates';

type OrgId = Types.ObjectId | string;
const oid = (id: OrgId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

/** A clock-in older than this with no clock-out is treated as forgotten, not as a very long shift. */
export const MAX_SHIFT_HOURS = 16;

export type Schedule = Pick<IAttendanceSettings, 'shiftStart' | 'shiftEnd' | 'graceMinutes' | 'fullDayMinutes' | 'halfDayMinutes'>;

export type DayStatus =
  | 'present'
  | 'half_day'
  | 'absent'
  | 'on_leave'
  | 'holiday'
  | 'weekend'
  | 'worked_on_off_day'
  | 'in_progress'
  | 'not_in_yet'
  | 'missing_clock_out'
  | 'upcoming'
  /** Before the person's joining date: nothing was expected of them yet. */
  | 'not_joined';

export interface DayLeave {
  halfDay: HalfDay | null;
  typeName: string;
}

export interface DayInput {
  date: string;
  today: string;
  now: Date;
  punches: Pick<IAttendancePunch, 'clockIn' | 'clockOut'>[];
  leave: DayLeave | null;
  wfh: boolean;
  holidayName: string | null;
  weekend: boolean;
  schedule: Schedule;
  /** The person's joining date (YYYY-MM-DD); days before it aren't absences. */
  joinedOn?: string | null;
}

export interface DayView {
  date: string;
  status: DayStatus;
  workedMinutes: number;
  firstIn: Date | null;
  lastOut: Date | null;
  late: boolean;
  wfh: boolean;
  leave: DayLeave | null;
  holidayName: string | null;
  /** A punch without a clock-out on a day that's over: it needs a fix. */
  missingClockOut: boolean;
}

// ---------------------------------------------------------------- the rules

/**
 * One person's status on one day (spec default 3). Pure: everything it needs is
 * passed in, so the same rules serve "my month", the team view and the CSV.
 */
export function dayStatus(input: DayInput): DayView {
  const { date, today, now, punches, leave, wfh, holidayName, weekend, schedule, joinedOn } = input;
  const sorted = [...punches].sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());
  const isToday = date === today;

  let workedMs = 0;
  let missingClockOut = false;
  for (const p of sorted) {
    if (p.clockOut) workedMs += Math.max(0, p.clockOut.getTime() - p.clockIn.getTime());
    // Still clocked in today: count up to now. A forgotten clock-out counts nothing (default 4).
    else if (isToday && now.getTime() - p.clockIn.getTime() <= MAX_SHIFT_HOURS * 3600_000) workedMs += now.getTime() - p.clockIn.getTime();
    else missingClockOut = true;
  }
  const workedMinutes = Math.floor(workedMs / 60_000);
  const firstIn = sorted[0]?.clockIn ?? null;
  const closed = sorted.filter((p) => p.clockOut);
  const lastOut = closed.length ? closed[closed.length - 1].clockOut : null;
  const offDay = weekend || holidayName !== null;

  // Late: only against a normal working day, and not when the morning was on leave.
  const late =
    firstIn !== null && !offDay && leave?.halfDay !== 'first' && !(leave && !leave.halfDay) &&
    minutesOfDay(firstIn) > hmToMinutes(schedule.shiftStart) + schedule.graceMinutes;

  const base = { date, workedMinutes, firstIn, lastOut, late, wfh, leave, holidayName, missingClockOut };

  let status: DayStatus;
  if (joinedOn && date < joinedOn && sorted.length === 0) {
    status = 'not_joined';
  } else if (offDay) {
    status = sorted.length ? 'worked_on_off_day' : weekend && !holidayName ? 'weekend' : 'holiday';
  } else if (leave && !leave.halfDay) {
    status = 'on_leave';
  } else if (date > today) {
    status = 'upcoming';
  } else if (missingClockOut) {
    status = 'missing_clock_out';
  } else {
    // A half day of leave halves what's needed for "present".
    const needed = leave ? schedule.halfDayMinutes : schedule.fullDayMinutes;
    if (workedMinutes >= needed) status = 'present';
    else if (isToday) status = sorted.length ? 'in_progress' : 'not_in_yet';
    else if (!leave && workedMinutes >= schedule.halfDayMinutes) status = 'half_day';
    else status = 'absent';
  }
  return { ...base, status };
}

// ---------------------------------------------------------------- settings

export async function getSettings(organizationId: OrgId): Promise<IAttendanceSettings> {
  // Upsert so concurrent first reads can't create two (organizationId is unique).
  return (await AttendanceSettingsModel.findOneAndUpdate(
    { organizationId: oid(organizationId) },
    { $setOnInsert: { organizationId: oid(organizationId), ...DEFAULT_ATTENDANCE_SETTINGS } },
    { upsert: true, returnDocument: 'after' }
  ))!;
}

export function toSchedule(s: Schedule): Schedule {
  return {
    shiftStart: s.shiftStart,
    shiftEnd: s.shiftEnd,
    graceMinutes: s.graceMinutes,
    fullDayMinutes: s.fullDayMinutes,
    halfDayMinutes: s.halfDayMinutes,
  };
}

// ---------------------------------------------------------------- loading days

/** Approved leave per employee per date (working dates only matter; off days are decided first). */
async function approvedLeaveByDay(organizationId: OrgId, from: string, to: string, employeeIds: Types.ObjectId[]) {
  const requests = await LeaveRequestModel.find({
    organizationId: oid(organizationId),
    employeeId: { $in: employeeIds },
    status: 'approved',
    startDate: { $lte: to },
    endDate: { $gte: from },
  });
  const typeIds = [...new Set(requests.map((r) => String(r.leaveTypeId)))];
  const types = typeIds.length ? await LeaveTypeModel.find({ _id: { $in: typeIds } }, { name: 1 }) : [];
  const typeNames = new Map(types.map((t) => [String(t._id), t.name]));
  const byKey = new Map<string, DayLeave>();
  for (const r of requests) {
    for (const d of eachDate(r.startDate > from ? r.startDate : from, r.endDate < to ? r.endDate : to)) {
      byKey.set(`${r.employeeId}|${d}`, { halfDay: r.halfDay, typeName: typeNames.get(String(r.leaveTypeId)) ?? 'Leave' });
    }
  }
  return byKey;
}

/** Every day's view in [from, to] for each of `employeeIds`. */
export async function daysFor(
  organizationId: OrgId,
  employeeIds: Types.ObjectId[],
  from: string,
  to: string,
  at: Date = currentInstant()
): Promise<Map<string, DayView[]>> {
  const org = oid(organizationId);
  const [settings, punches, leave, holidays, wfh, people] = await Promise.all([
    getSettings(org),
    AttendancePunchModel.find({ organizationId: org, employeeId: { $in: employeeIds }, date: { $gte: from, $lte: to }, isDeleted: false }),
    approvedLeaveByDay(org, from, to, employeeIds),
    holidayRepository.find({ organizationId: org, date: { $gte: from, $lte: to } }),
    approvedWfhKeys(org, employeeIds, from, to),
    UserModel.find({ organizationId: org, _id: { $in: employeeIds } }, { joiningDate: 1, createdAt: 1 }),
  ]);
  const joinedOn = new Map(people.map((u) => [String(u._id), effectiveJoiningDate(u)]));
  const holidayNames = new Map(holidays.map((h) => [h.date, h.name]));
  const punchesByKey = new Map<string, IAttendancePunch[]>();
  for (const p of punches) {
    const key = `${p.employeeId}|${p.date}`;
    punchesByKey.set(key, [...(punchesByKey.get(key) ?? []), p]);
  }
  const today = todayIso(at);
  const schedule = toSchedule(settings);
  const result = new Map<string, DayView[]>();
  for (const employeeId of employeeIds) {
    result.set(
      String(employeeId),
      eachDate(from, to).map((date) =>
        dayStatus({
          date,
          today,
          now: at,
          punches: punchesByKey.get(`${employeeId}|${date}`) ?? [],
          leave: leave.get(`${employeeId}|${date}`) ?? null,
          wfh: wfh.has(`${employeeId}|${date}`),
          holidayName: holidayNames.get(date) ?? null,
          weekend: isWeekend(date),
          schedule,
          joinedOn: joinedOn.get(String(employeeId)) ?? null,
        })
      )
    );
  }
  return result;
}

export interface MonthTotals {
  present: number;
  halfDay: number;
  absent: number;
  late: number;
  onLeave: number;
  /** Average worked minutes over the days something was worked. */
  averageMinutes: number;
}

export function monthTotals(days: DayView[]): MonthTotals {
  const worked = days.filter((d) => d.workedMinutes > 0 && d.status !== 'in_progress');
  return {
    present: days.filter((d) => d.status === 'present').length,
    halfDay: days.filter((d) => d.status === 'half_day').length,
    absent: days.filter((d) => d.status === 'absent').length,
    late: days.filter((d) => d.late).length,
    onLeave: days.reduce((n, d) => n + (d.leave ? (d.leave.halfDay ? 0.5 : 1) : 0), 0),
    averageMinutes: worked.length ? Math.round(worked.reduce((n, d) => n + d.workedMinutes, 0) / worked.length) : 0,
  };
}

export async function myMonth(organizationId: OrgId, employeeId: OrgId, month: string, at: Date = currentInstant()) {
  const { from, to } = monthRange(month);
  const days = (await daysFor(organizationId, [oid(employeeId)], from, to, at)).get(String(employeeId))!;
  return { month, days, totals: monthTotals(days) };
}

// ---------------------------------------------------------------- clocking

/** Sets aside a clock-in that has been open too long: it stays on its day as "missing clock-out". */
async function setAsideStalePunch(organizationId: Types.ObjectId, employeeId: Types.ObjectId, at: Date): Promise<void> {
  await AttendancePunchModel.updateMany(
    { organizationId, employeeId, isOpen: true, isDeleted: false, clockIn: { $lt: new Date(at.getTime() - MAX_SHIFT_HOURS * 3600_000) } },
    { $set: { isOpen: false } }
  );
}

async function fullDayLeaveOn(organizationId: Types.ObjectId, employeeId: Types.ObjectId, date: string) {
  return LeaveRequestModel.findOne({ organizationId, employeeId, status: 'approved', halfDay: null, startDate: { $lte: date }, endDate: { $gte: date } });
}

export async function clockIn(organizationId: OrgId, employeeId: OrgId, at: Date = currentInstant()): Promise<IAttendancePunch> {
  const org = oid(organizationId);
  const emp = oid(employeeId);
  const date = todayIso(at);
  if (await fullDayLeaveOn(org, emp, date)) {
    throw new ApiError(409, "You're on leave today, so there's nothing to clock in for");
  }
  await setAsideStalePunch(org, emp, at);
  try {
    return await AttendancePunchModel.create({ organizationId: org, employeeId: emp, date, clockIn: at, isOpen: true, source: 'web', createdBy: emp, updatedBy: emp });
  } catch (err) {
    // The one-open-punch index: already clocked in (or a double click).
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, "You're already clocked in");
    throw err;
  }
}

export async function clockOut(organizationId: OrgId, employeeId: OrgId, at: Date = currentInstant()): Promise<IAttendancePunch> {
  const org = oid(organizationId);
  const emp = oid(employeeId);
  await setAsideStalePunch(org, emp, at);
  // Atomic: only the open punch, and only once.
  const closed = await AttendancePunchModel.findOneAndUpdate(
    { organizationId: org, employeeId: emp, isOpen: true, isDeleted: false, clockIn: { $lt: at } },
    { $set: { clockOut: at, isOpen: false, updatedBy: emp } },
    { returnDocument: 'after' }
  );
  if (!closed) throw new ApiError(409, "You're not clocked in");
  return closed;
}

/** Everything the clock card needs. */
export async function today(organizationId: OrgId, employeeId: OrgId, at: Date = currentInstant()) {
  const org = oid(organizationId);
  const emp = oid(employeeId);
  const date = todayIso(at);
  const [settings, days, punches, open] = await Promise.all([
    getSettings(org),
    daysFor(org, [emp], date, date, at),
    AttendancePunchModel.find({ organizationId: org, employeeId: emp, date, isDeleted: false }).sort({ clockIn: 1 }),
    AttendancePunchModel.findOne({ organizationId: org, employeeId: emp, isOpen: true, isDeleted: false, clockIn: { $gte: new Date(at.getTime() - MAX_SHIFT_HOURS * 3600_000) } }),
  ]);
  const day = days.get(String(emp))![0];
  const clockedIn = Boolean(open);
  let cannotClockInReason: string | null = null;
  if (clockedIn) cannotClockInReason = "You're already clocked in";
  else if (day.leave && !day.leave.halfDay) cannotClockInReason = "You're on leave today";
  return {
    date,
    now: at,
    schedule: toSchedule(settings),
    day,
    punches: punches.map((p) => ({ id: String(p._id), clockIn: p.clockIn, clockOut: p.clockOut, source: p.source })),
    clockedIn,
    clockedInSince: open?.clockIn ?? null,
    canClockIn: cannotClockInReason === null,
    cannotClockInReason,
    canClockOut: clockedIn,
  };
}

// ---------------------------------------------------------------- presence

/** Where someone is right now, for the people search and profile. */
export type Presence = 'in' | 'out' | 'on_leave' | 'off' | 'not_in';

/**
 * For each employee: clocked in now, clocked out for the day (or a break), on
 * full-day leave, having a day off (weekend/holiday), or not in yet; plus WFH.
 */
export async function presenceFor(
  organizationId: OrgId,
  employeeIds: Types.ObjectId[],
  at: Date = currentInstant()
): Promise<Map<string, { presence: Presence; wfh: boolean }>> {
  const org = oid(organizationId);
  const date = todayIso(at);
  const [days, open] = await Promise.all([
    daysFor(org, employeeIds, date, date, at),
    AttendancePunchModel.find(
      { organizationId: org, employeeId: { $in: employeeIds }, isOpen: true, isDeleted: false, clockIn: { $gte: new Date(at.getTime() - MAX_SHIFT_HOURS * 3600_000) } },
      { employeeId: 1 }
    ),
  ]);
  const clockedIn = new Set(open.map((p) => String(p.employeeId)));
  const result = new Map<string, { presence: Presence; wfh: boolean }>();
  for (const id of employeeIds) {
    const day = days.get(String(id))![0];
    let presence: Presence;
    if (clockedIn.has(String(id))) presence = 'in';
    else if (day.firstIn) presence = 'out';
    else if (day.status === 'on_leave') presence = 'on_leave';
    else if (day.status === 'holiday' || day.status === 'weekend') presence = 'off';
    else presence = 'not_in';
    result.set(String(id), { presence, wfh: day.wfh });
  }
  return result;
}
