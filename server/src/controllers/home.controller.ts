import { Request, Response } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { LeaveRequestModel } from '../models/leaveRequest.model';
import { LeaveTypeModel } from '../models/leaveType.model';
import { userRepository } from '../repositories/user.repository';
import { announcementService } from '../services/announcement.service';
import { moduleCounts } from '../services/dashboard.service';
import { holidayService } from '../services/holiday.service';
import { celebrationsBetween } from '../services/celebration.service';
import { balances, leaveDatesBetween, onLeaveOn } from '../services/leave.service';
import { activeMembers, departmentNameMap, teamMembers, teamOf, toPerson } from '../services/people.service';
import { todayIso, weekRange } from '../utils/dates';
import { successResponse, ApiError } from '../utils/apiResponse';

const UPCOMING_HOLIDAYS = 5;
const ANNOUNCEMENTS = 5;

/**
 * Everything the Home dashboard's side widgets need, in one round trip. Any member;
 * the module counts need dashboard read, and the approvals count is ORG_ADMIN only.
 */
export const getHomeSummary = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const isAdmin = req.user!.role === 'ORG_ADMIN';
  const today = todayIso();
  const week = weekRange(today);

  const [me, members, departmentNames] = await Promise.all([
    userRepository.findById(req.user!.id, { organizationId }),
    activeMembers(organizationId),
    departmentNameMap(organizationId),
  ]);
  if (!me) {
    throw new ApiError(404, 'User not found');
  }
  const team = teamMembers(teamOf(me, members));
  const teamIds = team.map((m) => m._id.toString());

  const [upcomingHolidays, leaveToday, teamWeek, announcements, myBalances, counts, pendingApprovals] = await Promise.all([
    holidayService.upcoming(organizationId, today, UPCOMING_HOLIDAYS),
    onLeaveOn(organizationId, today),
    teamIds.length ? leaveDatesBetween(organizationId, week.from, week.to, teamIds) : Promise.resolve(new Map<string, string[]>()),
    announcementService.list(organizationId, { limit: ANNOUNCEMENTS }),
    balances(organizationId, me._id, Number(today.slice(0, 4))),
    moduleCounts(req.user!, organizationId, { requireDashboard: true }),
    isAdmin ? LeaveRequestModel.countDocuments({ organizationId, status: 'pending' }) : Promise.resolve(null),
  ]);

  // Leave type names straight from the model, so a type deleted since still shows.
  const typeIds = [...new Set(leaveToday.map((r) => r.leaveTypeId.toString()))];
  const types = typeIds.length ? await LeaveTypeModel.find({ _id: { $in: typeIds } }, { name: 1 }) : [];
  const typeNames = new Map(types.map((t) => [t._id.toString(), t.name]));

  // Only people still active in the organization are listed.
  const memberById = new Map(members.map((m) => [m._id.toString(), m]));
  const onLeaveToday = leaveToday
    .flatMap((r) => {
      const person = memberById.get(r.employeeId.toString());
      return person ? [{ person, request: r }] : [];
    })
    .sort((a, b) => a.person.name.localeCompare(b.person.name))
    .map(({ person, request }) => ({
      employeeId: person._id.toString(),
      name: person.name,
      avatarUrl: toPerson(person, departmentNames).avatarUrl,
      jobTitle: person.jobTitle,
      leaveTypeName: typeNames.get(request.leaveTypeId.toString()) ?? 'Leave',
      halfDay: request.halfDay,
    }));

  const halfDayToday = new Map(onLeaveToday.map((l) => [l.employeeId, l.halfDay]));
  const teamSorted = [...team].sort((a, b) => a.name.localeCompare(b.name));
  const teamOnLeave = {
    /** How many people are in my team at all, so an empty list can say why. */
    size: team.length,
    today: teamSorted
      .filter((m) => halfDayToday.has(m._id.toString()))
      .map((m) => ({ ...toPerson(m, departmentNames), halfDay: halfDayToday.get(m._id.toString()) ?? null })),
    thisWeek: teamSorted
      .filter((m) => teamWeek.has(m._id.toString()))
      .map((m) => ({ person: toPerson(m, departmentNames), dates: teamWeek.get(m._id.toString())! })),
  };

  // Birthdays show only as a date this year: never a birth year or an age.
  const celebrations = celebrationsBetween(members, today).map((c) => ({
    person: toPerson(c.user, departmentNames),
    kind: c.kind,
    date: c.date,
    years: c.years,
  }));

  res.status(200).json(
    successResponse({
      today,
      week,
      upcomingHolidays,
      onLeaveToday,
      teamOnLeave,
      announcements,
      balances: myBalances,
      moduleCounts: counts,
      pendingApprovals,
      celebrations: {
        today: celebrations.filter((c) => c.date === today),
        upcoming: celebrations.filter((c) => c.date !== today),
      },
    })
  );
});
