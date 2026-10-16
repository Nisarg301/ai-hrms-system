import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { userRepository } from '../repositories/user.repository';
import { activeMembers, departmentNameMap, teamMembers, teamOf, toPerson } from '../services/people.service';
import { leaveDatesBetween, onLeaveOn } from '../services/leave.service';
import { IUser } from '../models/user.model';
import { todayIso, weekRange } from '../utils/dates';
import { successResponse, ApiError } from '../utils/apiResponse';

/**
 * My team (reporting-manager model): my manager, the colleagues who share that
 * manager, and the people who report to me.
 */
export const getMyTeam = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const [me, members, departmentNames] = await Promise.all([
    userRepository.findById(req.user!.id, { organizationId }),
    activeMembers(organizationId),
    departmentNameMap(organizationId),
  ]);
  if (!me) {
    throw new ApiError(404, 'User not found');
  }
  const team = teamOf(me, members);

  // Who in the team is out today, and on which dates this week (Mon–Sun).
  const teamIds = teamMembers(team).map((m) => m._id.toString());
  const today = todayIso();
  const week = weekRange(today);
  const [todays, thisWeek] = await Promise.all([
    onLeaveOn(organizationId, today),
    teamIds.length ? leaveDatesBetween(organizationId, week.from, week.to, teamIds) : Promise.resolve(new Map<string, string[]>()),
  ]);
  const todayByEmployee = new Map(todays.map((r) => [r.employeeId.toString(), r]));
  const withLeave = (m: IUser) => {
    const today = todayByEmployee.get(m._id.toString());
    return {
      ...toPerson(m, departmentNames),
      leaveToday: today ? { halfDay: today.halfDay } : null,
      leaveThisWeek: thisWeek.get(m._id.toString()) ?? [],
    };
  };

  res.status(200).json(
    successResponse({
      today,
      week,
      manager: team.manager ? withLeave(team.manager) : null,
      peers: team.peers.map(withLeave),
      directReports: team.directReports.map(withLeave),
    })
  );
});

function introductionOf(user: { introduction?: { about?: string; hobbies?: string; lovesAboutJob?: string } }) {
  return {
    about: user.introduction?.about ?? '',
    hobbies: user.introduction?.hobbies ?? '',
    lovesAboutJob: user.introduction?.lovesAboutJob ?? '',
  };
}

export const getMyIntroduction = asyncHandler(async (req: Request, res: Response) => {
  const me = await userRepository.findById(req.user!.id, { organizationId: req.orgFilter!.organizationId });
  if (!me) {
    throw new ApiError(404, 'User not found');
  }
  res.status(200).json(successResponse(introductionOf(me)));
});

/** My own personal details (just the date of birth for now). */
export const getMyDetails = asyncHandler(async (req: Request, res: Response) => {
  const me = await userRepository.findById(req.user!.id, { organizationId: req.orgFilter!.organizationId });
  if (!me) {
    throw new ApiError(404, 'User not found');
  }
  res.status(200).json(successResponse({ dateOfBirth: me.dateOfBirth ?? null }));
});

/** Only ever touches the caller's own record; null clears the date. */
export const updateMyDetails = asyncHandler(async (req: Request, res: Response) => {
  const updated = await userRepository.updateById(new Types.ObjectId(req.user!.id), { $set: { dateOfBirth: req.body.dateOfBirth } }, req.user!.id);
  if (!updated) {
    throw new ApiError(404, 'User not found');
  }
  res.status(200).json(successResponse({ dateOfBirth: updated.dateOfBirth ?? null }));
});

/** Only ever touches the caller's own record. */
export const updateMyIntroduction = asyncHandler(async (req: Request, res: Response) => {
  const set: Record<string, string> = {};
  for (const key of ['about', 'hobbies', 'lovesAboutJob'] as const) {
    if (req.body[key] !== undefined) set[`introduction.${key}`] = req.body[key];
  }
  const updated = await userRepository.updateById(new Types.ObjectId(req.user!.id), { $set: set }, req.user!.id);
  if (!updated) {
    throw new ApiError(404, 'User not found');
  }
  res.status(200).json(successResponse(introductionOf(updated)));
});
