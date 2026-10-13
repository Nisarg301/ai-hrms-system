import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { GoalCheckInModel } from '../models/goalCheckIn.model';
import { GoalModel, GoalStatus, IGoal } from '../models/goal.model';
import { UserModel } from '../models/user.model';
import { auditCrud } from '../services/audit.service';
import { departmentNameMap, Person, toPerson } from '../services/people.service';
import { Relation, directReports, goalForActor, goalOwnerFor, relationTo } from '../services/performance.service';
import { successResponse, ApiError } from '../utils/apiResponse';
import { todayIso } from '../utils/dates';
import { teamGoalsQuerySchema } from '../validators/performance.validators';

/** Running goals first (soonest due), then finished ones. */
const STATUS_RANK: Record<GoalStatus, number> = { behind: 0, at_risk: 0, on_track: 0, completed: 1, cancelled: 2 };
const sortGoals = (a: IGoal, b: IGoal) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.dueDate.localeCompare(b.dueDate);

async function peopleFor(organizationId: Types.ObjectId, ids: (Types.ObjectId | null | undefined)[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const [users, departments] = await Promise.all([UserModel.find({ _id: { $in: unique }, organizationId }), departmentNameMap(organizationId)]);
  return new Map(users.map((u) => [String(u._id), toPerson(u, departments)]));
}

function goalView(g: IGoal, people: Map<string, Person>, today: string) {
  return {
    id: String(g._id),
    ownerId: String(g.ownerId),
    owner: people.get(String(g.ownerId)) ?? null,
    title: g.title,
    description: g.description,
    startDate: g.startDate,
    dueDate: g.dueDate,
    weight: g.weight,
    progress: g.progress,
    status: g.status,
    overdue: g.dueDate < today && g.status !== 'completed' && g.status !== 'cancelled',
    lastCheckInAt: g.lastCheckInAt,
    checkInCount: g.checkInCount,
    createdByName: people.get(String(g.createdBy))?.name ?? null,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}

async function listView(organizationId: Types.ObjectId, goals: IGoal[]) {
  const people = await peopleFor(organizationId, goals.flatMap((g) => [g.ownerId, g.createdBy]));
  const today = todayIso();
  return [...goals].sort(sortGoals).map((g) => goalView(g, people, today));
}

/** A goal with its check-ins (newest first), how the actor relates to it, and whether they may delete it. */
async function detailView(organizationId: Types.ObjectId, goal: IGoal, relation: Exclude<Relation, 'none'>, actorId: string) {
  const checkIns = await GoalCheckInModel.find({ goalId: goal._id }).sort({ createdAt: -1, _id: -1 });
  const people = await peopleFor(organizationId, [goal.ownerId, goal.createdBy, ...checkIns.map((c) => c.authorId)]);
  return {
    ...goalView(goal, people, todayIso()),
    relation,
    // Whoever set it, the manager or an admin; and only while nothing has been recorded against it.
    canDelete: goal.checkInCount === 0 && (relation !== 'owner' || String(goal.createdBy) === actorId),
    checkIns: checkIns.map((c) => ({
      id: String(c._id),
      authorName: people.get(String(c.authorId))?.name ?? 'Former member',
      progress: c.progress,
      status: c.status,
      previousProgress: c.previousProgress,
      previousStatus: c.previousStatus,
      comment: c.comment,
      createdAt: c.createdAt,
    })),
  };
}

export const myGoals = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const goals = await GoalModel.find({ organizationId, ownerId: new Types.ObjectId(req.user!.id), isDeleted: false });
  res.status(200).json(successResponse(await listView(organizationId, goals)));
});

/**
 * My direct reports' goals; or one person's (`ownerId`) when I'm their manager or an
 * ORG_ADMIN. Anyone else's: 404.
 */
export const teamGoals = asyncHandler(async (req: Request, res: Response) => {
  const parsed = teamGoalsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  const organizationId = req.orgFilter!.organizationId;
  const { ownerId, status } = parsed.data;
  let owners: Types.ObjectId[];
  if (ownerId) {
    if ((await relationTo(organizationId, req.user!, ownerId)) === 'none') throw new ApiError(404, 'Employee not found');
    owners = [new Types.ObjectId(ownerId)];
  } else {
    owners = (await directReports(organizationId, req.user!.id)).map((u) => u._id as Types.ObjectId);
  }
  const goals = await GoalModel.find({ organizationId, ownerId: { $in: owners }, isDeleted: false, ...(status ? { status } : {}) });
  res.status(200).json(successResponse(await listView(organizationId, goals)));
});

export const getGoal = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const { goal, relation } = await goalForActor(organizationId, req.params.id, req.user!);
  res.status(200).json(successResponse(await detailView(organizationId, goal, relation, req.user!.id)));
});

export const createGoal = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const owner = await goalOwnerFor(organizationId, req.user!, req.body.ownerId);
  const goal = await GoalModel.create({
    organizationId,
    ownerId: owner._id,
    title: req.body.title,
    description: req.body.description,
    startDate: req.body.startDate,
    dueDate: req.body.dueDate,
    weight: req.body.weight,
    createdBy: req.user!.id,
    updatedBy: req.user!.id,
  });
  const relation = (await relationTo(organizationId, req.user!, owner._id as Types.ObjectId)) as Exclude<Relation, 'none'>;
  res.status(201).json(successResponse(await detailView(organizationId, goal, relation, req.user!.id)));
});

/** Title, description, dates and weight; progress and status change with a check-in. */
export const updateGoal = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const { goal, relation } = await goalForActor(organizationId, req.params.id, req.user!);
  const startDate = req.body.startDate ?? goal.startDate;
  const dueDate = req.body.dueDate ?? goal.dueDate;
  if (startDate > dueDate) {
    throw new ApiError(400, 'Validation failed', { fieldErrors: { dueDate: ['The due date can’t be before the start date'] } });
  }
  const updated = await GoalModel.findOneAndUpdate(
    { _id: goal._id, isDeleted: false },
    { $set: { ...req.body, updatedBy: req.user!.id } },
    { returnDocument: 'after' }
  );
  if (!updated) throw new ApiError(404, 'Goal not found');
  res.status(200).json(successResponse(await detailView(organizationId, updated, relation, req.user!.id)));
});

export const deleteGoal = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const { goal, relation } = await goalForActor(organizationId, req.params.id, req.user!);
  if (relation === 'owner' && String(goal.createdBy) !== req.user!.id) {
    throw new ApiError(403, 'Only whoever set this goal, your manager or an admin can delete it');
  }
  const deleted = await GoalModel.findOneAndUpdate(
    { _id: goal._id, isDeleted: false, checkInCount: 0 },
    { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: req.user!.id } },
    { returnDocument: 'after' }
  );
  if (!deleted) throw new ApiError(409, 'This goal has check-ins. Cancel it with a check-in instead.');
  if (relation !== 'owner') {
    const owner = await UserModel.findById(goal.ownerId, { name: 1 });
    await auditCrud(req, 'delete', 'performance', { id: String(goal._id), label: `Goal "${goal.title}" of ${owner?.name ?? 'a former member'}` });
  }
  res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});

/**
 * Where the goal stands now: progress, status (Cancelled cancels it; another status reopens
 * it) and a comment. Recorded with what it was before, for the timeline.
 */
export const checkIn = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const { goal, relation } = await goalForActor(organizationId, req.params.id, req.user!);
  const entry = await GoalCheckInModel.create({
    organizationId,
    goalId: goal._id,
    authorId: req.user!.id,
    progress: req.body.progress,
    status: req.body.status,
    previousProgress: goal.progress,
    previousStatus: goal.status,
    comment: req.body.comment,
  });
  const updated = await GoalModel.findOneAndUpdate(
    { _id: goal._id, isDeleted: false },
    { $set: { progress: req.body.progress, status: req.body.status, lastCheckInAt: entry.createdAt, updatedBy: req.user!.id }, $inc: { checkInCount: 1 } },
    { returnDocument: 'after' }
  );
  if (!updated) {
    // Deleted in the meantime.
    await GoalCheckInModel.deleteOne({ _id: entry._id });
    throw new ApiError(404, 'Goal not found');
  }
  res.status(201).json(successResponse(await detailView(organizationId, updated, relation, req.user!.id)));
});
