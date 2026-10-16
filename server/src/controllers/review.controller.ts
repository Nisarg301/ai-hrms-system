import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { IReview, IReviewPart, ReviewModel, ReviewPart } from '../models/review.model';
import { ICycleQuestion, IReviewCycle, ReviewCycleModel } from '../models/reviewCycle.model';
import { UserModel } from '../models/user.model';
import { auditCrud } from '../services/audit.service';
import { departmentNameMap, Person, toPerson } from '../services/people.service';
import { announceAssigned, announceReleased, announceSelfSubmitted } from '../services/performanceNotify.service';
import {
  assertComplete,
  assertWritable,
  canWriteManager,
  cleanAnswers,
  goalsInPeriod,
  partStatus,
  reviewForActor,
  ReviewRole,
} from '../services/performance.service';
import { successResponse, ApiError } from '../utils/apiResponse';

async function peopleFor(organizationId: Types.ObjectId, ids: (Types.ObjectId | null | undefined)[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const [users, departments] = await Promise.all([UserModel.find({ _id: { $in: unique }, organizationId }), departmentNameMap(organizationId)]);
  return new Map(users.map((u) => [String(u._id), toPerson(u, departments)]));
}

function cycleSummary(c: IReviewCycle) {
  return { id: String(c._id), name: c.name, periodFrom: c.periodFrom, periodTo: c.periodTo, selfDueDate: c.selfDueDate, managerDueDate: c.managerDueDate, status: c.status };
}

/** A part as the form shows it: every question, with its answer so far. */
function partView(part: IReviewPart, questions: ICycleQuestion[]) {
  const byId = new Map(part.answers.map((a) => [a.questionId, a.text]));
  return {
    status: partStatus(part),
    answers: questions.map((q) => ({ questionId: q.id, question: q.text, text: byId.get(q.id) ?? '' })),
    rating: part.rating,
    savedAt: part.savedAt,
    submittedAt: part.submittedAt,
  };
}

/**
 * What each side may see (Default 10):
 * - The employee: their own part always; the manager's only once released.
 * - The reviewer and ORG_ADMINs: the manager part, and the self part once it's submitted
 *   (a draft is the employee's own).
 */
async function reviewView(review: IReview, cycle: IReviewCycle, role: ReviewRole) {
  const organizationId = review.organizationId;
  const people = await peopleFor(organizationId, [review.employeeId, review.reviewerId]);
  const released = Boolean(review.releasedAt);
  const writable = cycle.status === 'launched' || cycle.status === 'released';
  const selfVisible = role === 'employee' || Boolean(review.self.submittedAt);
  const managerVisible = role !== 'employee' || released;
  const goals = review.goalsSnapshotAt
    ? review.goalsSnapshot.map((g) => ({ goalId: String(g.goalId), title: g.title, progress: g.progress, status: g.status, weight: g.weight, dueDate: g.dueDate }))
    : (await goalsInPeriod(organizationId, review.employeeId, cycle)).map((g) => ({
        goalId: String(g._id),
        title: g.title,
        progress: g.progress,
        status: g.status,
        weight: g.weight,
        dueDate: g.dueDate,
      }));
  return {
    id: String(review._id),
    cycle: { ...cycleSummary(cycle), questions: cycle.questions.map((q) => ({ id: q.id, text: q.text })) },
    role,
    employee: people.get(String(review.employeeId)) ?? null,
    reviewer: review.reviewerId ? (people.get(String(review.reviewerId)) ?? null) : null,
    selfStatus: partStatus(review.self),
    managerStatus: managerVisible ? partStatus(review.manager) : null,
    self: selfVisible ? partView(review.self, cycle.questions) : null,
    manager: managerVisible ? partView(review.manager, cycle.questions) : null,
    released,
    releasedAt: review.releasedAt,
    goals,
    goalsAsOf: review.goalsSnapshotAt,
    canWriteSelf: role === 'employee' && writable && !review.self.submittedAt,
    canWriteManager: canWriteManager(review, role) && writable && !review.manager.submittedAt,
  };
}

/** Reviews of cycles that have been launched (drafts aren't anyone's business yet). */
async function launchedCycles(organizationId: Types.ObjectId, ids: Types.ObjectId[]): Promise<Map<string, IReviewCycle>> {
  const cycles = await ReviewCycleModel.find({ _id: { $in: ids }, organizationId, isDeleted: false, status: { $ne: 'draft' } });
  return new Map(cycles.map((c) => [String(c._id), c]));
}

/** My own reviews, newest cycle first; the manager's side only once released. */
export const myReviews = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const reviews = await ReviewModel.find({ organizationId, employeeId: new Types.ObjectId(req.user!.id) });
  const cycles = await launchedCycles(organizationId, reviews.map((r) => r.cycleId));
  const people = await peopleFor(organizationId, reviews.map((r) => r.reviewerId));
  const rows = reviews
    .filter((r) => cycles.has(String(r.cycleId)))
    .map((r) => ({
      id: String(r._id),
      cycle: cycleSummary(cycles.get(String(r.cycleId))!),
      reviewer: r.reviewerId ? (people.get(String(r.reviewerId)) ?? null) : null,
      selfStatus: partStatus(r.self),
      released: Boolean(r.releasedAt),
      managerRating: r.releasedAt ? r.manager.rating : null,
    }))
    .sort((a, b) => b.cycle.periodTo.localeCompare(a.cycle.periodTo));
  res.status(200).json(successResponse(rows));
});

/**
 * Reviews I'm to write the manager part of, in open cycles: as the reviewer, or (ORG_ADMIN)
 * those without one. Never my own. Soonest due first.
 */
export const reviewsToWrite = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const me = new Types.ObjectId(req.user!.id);
  const reviews = await ReviewModel.find({
    organizationId,
    employeeId: { $ne: me },
    $or: [{ reviewerId: me }, ...(req.user!.role === 'ORG_ADMIN' ? [{ reviewerId: null }] : [])],
  });
  const cycles = await launchedCycles(organizationId, reviews.map((r) => r.cycleId));
  const people = await peopleFor(organizationId, reviews.map((r) => r.employeeId));
  const rows = reviews
    .filter((r) => {
      const c = cycles.get(String(r.cycleId));
      return c && c.status !== 'closed';
    })
    .map((r) => ({
      id: String(r._id),
      cycle: cycleSummary(cycles.get(String(r.cycleId))!),
      employee: people.get(String(r.employeeId)) ?? null,
      selfStatus: partStatus(r.self),
      managerStatus: partStatus(r.manager),
      released: Boolean(r.releasedAt),
    }))
    .sort((a, b) => a.cycle.managerDueDate.localeCompare(b.cycle.managerDueDate) || (a.employee?.name ?? '').localeCompare(b.employee?.name ?? ''));
  res.status(200).json(successResponse(rows));
});

export const getReview = asyncHandler(async (req: Request, res: Response) => {
  const { review, cycle, role } = await reviewForActor(req.orgFilter!.organizationId, req.params.id, req.user!);
  if (cycle.status === 'draft') throw new ApiError(404, 'Review not found');
  res.status(200).json(successResponse(await reviewView(review, cycle, role)));
});

const PART_LABEL: Record<ReviewPart, string> = { self: 'Your self review', manager: 'The manager review' };

/**
 * Saves a draft of one part, or submits it (every question and a rating). Submitting stores
 * the goals as they stand; if the cycle is already released and both parts are now in, the
 * review is released straight away.
 */
function writePart(part: ReviewPart, submit: boolean) {
  return asyncHandler(async (req: Request, res: Response) => {
    const organizationId = req.orgFilter!.organizationId;
    const { review, cycle, role } = await reviewForActor(organizationId, req.params.id, req.user!);
    const allowed = part === 'self' ? role === 'employee' : canWriteManager(review, role);
    if (!allowed) {
      throw new ApiError(403, part === 'self' ? 'Only the person reviewed writes the self review' : 'Only the reviewer writes the manager review');
    }
    assertWritable(cycle);
    if (review[part].submittedAt) throw new ApiError(409, `${PART_LABEL[part]} is already submitted`);

    const answers = cleanAnswers(cycle.questions, req.body.answers);
    const now = new Date();
    const set: Record<string, unknown> = { [`${part}.answers`]: answers, [`${part}.rating`]: req.body.rating, [`${part}.savedAt`]: now };
    if (submit) {
      assertComplete(cycle.questions, { answers, rating: req.body.rating });
      const goals = await goalsInPeriod(organizationId, review.employeeId, cycle);
      Object.assign(set, {
        [`${part}.submittedAt`]: now,
        [`${part}.submittedBy`]: req.user!.id,
        goalsSnapshot: goals.map((g) => ({ goalId: g._id, title: g.title, progress: g.progress, status: g.status, weight: g.weight, dueDate: g.dueDate })),
        goalsSnapshotAt: now,
      });
    }
    let updated = await ReviewModel.findOneAndUpdate({ _id: review._id, [`${part}.submittedAt`]: null }, { $set: set }, { returnDocument: 'after' });
    if (!updated) throw new ApiError(409, `${PART_LABEL[part]} is already submitted`);
    if (submit && part === 'self') await announceSelfSubmitted(updated, cycle, req.user!.id);
    if (submit && cycle.status === 'released' && updated.self.submittedAt && updated.manager.submittedAt) {
      const released = await ReviewModel.findOneAndUpdate({ _id: review._id, releasedAt: null }, { $set: { releasedAt: now } }, { returnDocument: 'after' });
      if (released) {
        updated = released;
        await announceReleased([released], cycle, req.user!.id);
      }
    }
    res.status(200).json(successResponse(await reviewView(updated, cycle, role)));
  });
}

export const saveSelf = writePart('self', false);
export const submitSelf = writePart('self', true);
export const saveManager = writePart('manager', false);
export const submitManager = writePart('manager', true);

/** "Reopened the self review of Ivy Mehta (H2 2026)". Answers and ratings never go in the audit log. */
async function auditReview(req: Request, review: IReview, cycle: IReviewCycle, label: (name: string) => string) {
  const employee = await UserModel.findById(review.employeeId, { name: 1 });
  await auditCrud(req, 'update', 'performance', { id: String(review._id), label: `${label(employee?.name ?? 'a former member')} (${cycle.name})` });
}

/** An ORG_ADMIN, about someone else's review in an open cycle. */
async function adminReview(req: Request) {
  const found = await reviewForActor(req.orgFilter!.organizationId, req.params.id, req.user!);
  if (found.role === 'employee') throw new ApiError(403, 'Ask another admin to change your own review');
  assertWritable(found.cycle);
  return found;
}

/** Back to a draft (answers kept) so it can be changed; a released review is hidden again until resubmitted. */
export const reopen = asyncHandler(async (req: Request, res: Response) => {
  const { review, cycle, role } = await adminReview(req);
  const part = req.body.part as ReviewPart;
  const updated = await ReviewModel.findOneAndUpdate(
    { _id: review._id, [`${part}.submittedAt`]: { $ne: null } },
    { $set: { [`${part}.submittedAt`]: null, [`${part}.submittedBy`]: null, releasedAt: null } },
    { returnDocument: 'after' }
  );
  if (!updated) throw new ApiError(409, `${part === 'self' ? 'The self review' : 'The manager review'} isn’t submitted`);
  await auditReview(req, updated, cycle, (name) => `Reopened the ${part} review of ${name}`);
  res.status(200).json(successResponse(await reviewView(updated, cycle, role)));
});

/** A different reviewer (or null: any ORG_ADMIN), while the manager part isn't submitted. */
export const reassign = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const { review, cycle, role } = await adminReview(req);
  const reviewerId: string | null = req.body.reviewerId;
  if (reviewerId) {
    const ok =
      reviewerId !== String(review.employeeId) &&
      (await UserModel.exists({ _id: reviewerId, organizationId, role: { $in: ['ORG_ADMIN', 'ORG_USER'] }, status: 'active', isDeleted: false }));
    if (!ok) throw new ApiError(400, 'Validation failed', { fieldErrors: { reviewerId: ['Choose an active member other than the person reviewed'] } });
  }
  const updated = await ReviewModel.findOneAndUpdate(
    { _id: review._id, 'manager.submittedAt': null },
    { $set: { reviewerId: reviewerId ? new Types.ObjectId(reviewerId) : null } },
    { returnDocument: 'after' }
  );
  if (!updated) throw new ApiError(409, 'The manager review is already submitted. Reopen it first.');
  const reviewer = reviewerId ? await UserModel.findById(reviewerId, { name: 1 }) : null;
  await auditReview(req, updated, cycle, (name) => `Reviewer of ${name} changed to ${reviewer?.name ?? 'the admins'}`);
  await announceAssigned(updated, cycle, req.user!.id);
  res.status(200).json(successResponse(await reviewView(updated, cycle, role)));
});
