import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { IReview, ReviewModel } from '../models/review.model';
import { IReviewCycle, ReviewCycleModel } from '../models/reviewCycle.model';
import { UserModel } from '../models/user.model';
import { auditCrud } from '../services/audit.service';
import { departmentNameMap, Person, toPerson } from '../services/people.service';
import { announceLaunch, announceReleased } from '../services/performanceNotify.service';
import { assertCycleShape, cycleForAdmin, DEFAULT_QUESTIONS, participantsFor, partStatus, withQuestionIds } from '../services/performance.service';
import { successResponse, ApiError } from '../utils/apiResponse';
import { todayIso } from '../utils/dates';
import { cycleReviewsQuerySchema } from '../validators/performance.validators';

type Counts = { selfSubmitted: number; managerSubmitted: number; released: number };

/** "Review cycle H2 2026 launched (6 people)". Answers and ratings never go in the audit log. */
const audit = (req: Request, action: 'create' | 'update' | 'delete', c: IReviewCycle, what: string) =>
  auditCrud(req, action, 'performance', { id: String(c._id), label: `Review cycle ${c.name} ${what}` });

/** Per cycle: how many self and manager parts are in, and how many reviews are released. */
async function countsFor(cycleIds: Types.ObjectId[]): Promise<Map<string, Counts>> {
  if (!cycleIds.length) return new Map();
  const rows = await ReviewModel.aggregate<{ _id: Types.ObjectId } & Counts>([
    { $match: { cycleId: { $in: cycleIds } } },
    {
      $group: {
        _id: '$cycleId',
        selfSubmitted: { $sum: { $cond: [{ $ne: ['$self.submittedAt', null] }, 1, 0] } },
        managerSubmitted: { $sum: { $cond: [{ $ne: ['$manager.submittedAt', null] }, 1, 0] } },
        released: { $sum: { $cond: [{ $ne: ['$releasedAt', null] }, 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map(({ _id, ...c }) => [String(_id), c]));
}

function cycleView(c: IReviewCycle, counts: Counts | undefined) {
  return {
    id: String(c._id),
    name: c.name,
    periodFrom: c.periodFrom,
    periodTo: c.periodTo,
    selfDueDate: c.selfDueDate,
    managerDueDate: c.managerDueDate,
    scope: c.scope,
    departmentIds: c.departmentIds.map(String),
    questions: c.questions.map((q) => ({ id: q.id, text: q.text })),
    status: c.status,
    participantCount: c.participantCount,
    counts: counts ?? { selfSubmitted: 0, managerSubmitted: 0, released: 0 },
    launchedAt: c.launchedAt,
    releasedAt: c.releasedAt,
    closedAt: c.closedAt,
    createdAt: c.createdAt,
  };
}

async function oneView(c: IReviewCycle) {
  return cycleView(c, (await countsFor([c._id as Types.ObjectId])).get(String(c._id)));
}

/** Moves a cycle between states in one atomic update; a stale move gets 409 with where it is. */
async function transition(cycle: IReviewCycle, from: IReviewCycle['status'][], set: Record<string, unknown>): Promise<IReviewCycle> {
  const updated = await ReviewCycleModel.findOneAndUpdate({ _id: cycle._id, isDeleted: false, status: { $in: from } }, { $set: set }, { returnDocument: 'after' });
  if (updated) return updated;
  const current = await ReviewCycleModel.findById(cycle._id);
  throw new ApiError(409, `This review cycle is ${current?.status ?? 'gone'}`);
}

export const listCycles = asyncHandler(async (req: Request, res: Response) => {
  const cycles = await ReviewCycleModel.find({ organizationId: req.orgFilter!.organizationId, isDeleted: false }).sort({ createdAt: -1, _id: -1 });
  const counts = await countsFor(cycles.map((c) => c._id as Types.ObjectId));
  res.status(200).json(successResponse(cycles.map((c) => cycleView(c, counts.get(String(c._id))))));
});

export const getCycle = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(successResponse(await oneView(await cycleForAdmin(req.orgFilter!.organizationId, req.params.id))));
});

/** A draft, with the default questions unless others are given. */
export const createCycle = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  await assertCycleShape(organizationId, req.body);
  const cycle = await ReviewCycleModel.create({
    organizationId,
    ...req.body,
    questions: withQuestionIds(req.body.questions ?? DEFAULT_QUESTIONS.map((text) => ({ text }))),
    createdBy: req.user!.id,
    updatedBy: req.user!.id,
  });
  await audit(req, 'create', cycle, 'created');
  res.status(201).json(successResponse(await oneView(cycle)));
});

/** Drafts only: once launched, the questions and dates are what people are working to. */
export const updateCycle = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const cycle = await cycleForAdmin(organizationId, req.params.id);
  if (cycle.status !== 'draft') throw new ApiError(409, 'Only a draft cycle can be changed');
  const merged = {
    periodFrom: req.body.periodFrom ?? cycle.periodFrom,
    periodTo: req.body.periodTo ?? cycle.periodTo,
    selfDueDate: req.body.selfDueDate ?? cycle.selfDueDate,
    managerDueDate: req.body.managerDueDate ?? cycle.managerDueDate,
    scope: req.body.scope ?? cycle.scope,
    departmentIds: req.body.departmentIds ?? cycle.departmentIds,
  };
  await assertCycleShape(organizationId, merged);
  const set: Record<string, unknown> = { ...req.body, updatedBy: req.user!.id };
  if (req.body.questions) set.questions = withQuestionIds(req.body.questions);
  const updated = await transition(cycle, ['draft'], set);
  await audit(req, 'update', updated, 'edited');
  res.status(200).json(successResponse(await oneView(updated)));
});

export const deleteCycle = asyncHandler(async (req: Request, res: Response) => {
  const cycle = await cycleForAdmin(req.orgFilter!.organizationId, req.params.id);
  if (cycle.status !== 'draft') throw new ApiError(409, 'Only a draft cycle can be deleted');
  await transition(cycle, ['draft'], { isDeleted: true, updatedBy: req.user!.id });
  await audit(req, 'delete', cycle, 'deleted');
  res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});

/**
 * Creates a review for each participant, with their reviewer fixed now (Default 9), and
 * locks the questions. Without transactions: if writing the reviews fails, it's undone.
 */
export const launchCycle = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const cycle = await cycleForAdmin(organizationId, req.params.id);
  if (cycle.status !== 'draft') throw new ApiError(409, `This review cycle is ${cycle.status}`);
  if (cycle.managerDueDate < todayIso()) throw new ApiError(400, 'The due dates have passed. Change them before launching.');
  const participants = await participantsFor(organizationId, cycle);
  if (!participants.length) throw new ApiError(400, 'Nobody would take part: no active people joined by the end of the period in the chosen scope.');

  const launched = await transition(cycle, ['draft'], { status: 'launched', launchedAt: new Date(), launchedBy: req.user!.id, participantCount: participants.length });
  try {
    await ReviewModel.insertMany(
      participants.map(({ employee, reviewerId }) => ({
        organizationId,
        cycleId: cycle._id,
        employeeId: employee._id,
        reviewerId,
        departmentId: employee.department ?? null,
      }))
    );
  } catch (err) {
    await ReviewModel.deleteMany({ cycleId: cycle._id });
    await ReviewCycleModel.updateOne({ _id: cycle._id }, { $set: { status: 'draft', launchedAt: null, launchedBy: null, participantCount: 0 } });
    throw err;
  }
  await audit(req, 'update', launched, `launched (${participants.length} ${participants.length === 1 ? 'person' : 'people'})`);
  await announceLaunch(launched, req.user!.id);
  res.status(200).json(successResponse(await oneView(launched)));
});

/**
 * People can see their manager's review: every review whose two parts are in now, and any
 * completed later the moment it's complete.
 */
export const releaseCycle = asyncHandler(async (req: Request, res: Response) => {
  const cycle = await cycleForAdmin(req.orgFilter!.organizationId, req.params.id);
  const now = new Date();
  const released = await transition(cycle, ['launched'], { status: 'released', releasedAt: now, releasedBy: req.user!.id });
  const { modifiedCount } = await ReviewModel.updateMany(
    { cycleId: cycle._id, 'self.submittedAt': { $ne: null }, 'manager.submittedAt': { $ne: null }, releasedAt: null },
    { $set: { releasedAt: now } }
  );
  await audit(req, 'update', released, `released (${modifiedCount} ${modifiedCount === 1 ? 'review' : 'reviews'})`);
  await announceReleased(await ReviewModel.find({ cycleId: cycle._id, releasedAt: now }), released, req.user!.id);
  res.status(200).json(successResponse({ ...(await oneView(released)), releasedNow: modifiedCount }));
});

/** Read-only from now on; unfinished reviews stay unfinished. */
export const closeCycle = asyncHandler(async (req: Request, res: Response) => {
  const cycle = await cycleForAdmin(req.orgFilter!.organizationId, req.params.id);
  const closed = await transition(cycle, ['launched', 'released'], { status: 'closed', closedAt: new Date(), closedBy: req.user!.id });
  await audit(req, 'update', closed, 'closed');
  res.status(200).json(successResponse(await oneView(closed)));
});

function rowView(r: IReview, people: Map<string, Person>, departments: Map<string, string>) {
  return {
    id: String(r._id),
    employee: people.get(String(r.employeeId)) ?? null,
    reviewer: r.reviewerId ? (people.get(String(r.reviewerId)) ?? null) : null,
    departmentName: r.departmentId ? (departments.get(String(r.departmentId)) ?? null) : null,
    selfStatus: partStatus(r.self),
    managerStatus: partStatus(r.manager),
    selfRating: r.self.submittedAt ? r.self.rating : null,
    managerRating: r.manager.submittedAt ? r.manager.rating : null,
    released: Boolean(r.releasedAt),
  };
}

/** Everyone in a cycle, with where each review stands (ORG_ADMIN). */
export const cycleReviews = asyncHandler(async (req: Request, res: Response) => {
  const parsed = cycleReviewsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  const organizationId = req.orgFilter!.organizationId;
  const cycle = await cycleForAdmin(organizationId, req.params.id);
  const { status, departmentId } = parsed.data;
  const filter: Record<string, unknown> = { cycleId: cycle._id, ...(departmentId ? { departmentId: new Types.ObjectId(departmentId) } : {}) };
  if (status === 'self_pending') filter['self.submittedAt'] = null;
  if (status === 'manager_pending') filter['manager.submittedAt'] = null;
  if (status === 'complete') Object.assign(filter, { 'self.submittedAt': { $ne: null }, 'manager.submittedAt': { $ne: null }, releasedAt: null });
  if (status === 'released') filter.releasedAt = { $ne: null };
  const reviews = await ReviewModel.find(filter);
  const ids = [...new Set(reviews.flatMap((r) => [r.employeeId, r.reviewerId]).filter(Boolean).map(String))];
  const [users, departments] = await Promise.all([UserModel.find({ _id: { $in: ids }, organizationId }), departmentNameMap(organizationId)]);
  const people = new Map(users.map((u) => [String(u._id), toPerson(u, departments)]));
  const rows = reviews.map((r) => rowView(r, people, departments)).sort((a, b) => (a.employee?.name ?? '').localeCompare(b.employee?.name ?? ''));
  res.status(200).json(successResponse(rows));
});

const average = (ratings: number[]) => (ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null);

/**
 * How a cycle is going: the share of self and manager parts in, how many of each rating
 * (1–5, submitted parts only), and average ratings by department (Default 14).
 */
export const cycleSummary = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const cycle = await cycleForAdmin(organizationId, req.params.id);
  const reviews = await ReviewModel.find({ cycleId: cycle._id });
  const departments = await departmentNameMap(organizationId);
  const submitted = (part: 'self' | 'manager') => reviews.filter((r) => r[part].submittedAt);
  const histogram = (part: 'self' | 'manager') => [1, 2, 3, 4, 5].map((n) => submitted(part).filter((r) => r[part].rating === n).length);
  const percent = (n: number) => (reviews.length ? Math.round((n / reviews.length) * 100) : 0);

  const groups = new Map<string, IReview[]>();
  for (const r of reviews) {
    const key = r.departmentId ? String(r.departmentId) : '';
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const byDepartment = [...groups]
    .map(([key, rs]) => ({
      departmentId: key || null,
      name: key ? (departments.get(key) ?? 'Unknown') : 'No department',
      participants: rs.length,
      selfAverage: average(rs.filter((r) => r.self.submittedAt).map((r) => r.self.rating!)),
      managerAverage: average(rs.filter((r) => r.manager.submittedAt).map((r) => r.manager.rating!)),
    }))
    .sort((a, b) => Number(!a.departmentId) - Number(!b.departmentId) || a.name.localeCompare(b.name));

  res.status(200).json(
    successResponse({
      participants: reviews.length,
      selfSubmitted: submitted('self').length,
      managerSubmitted: submitted('manager').length,
      released: reviews.filter((r) => r.releasedAt).length,
      selfPercent: percent(submitted('self').length),
      managerPercent: percent(submitted('manager').length),
      ratings: { self: histogram('self'), manager: histogram('manager') },
      byDepartment,
    })
  );
});
