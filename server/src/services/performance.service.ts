import { Types } from 'mongoose';
import { GoalModel, IGoal } from '../models/goal.model';
import { DepartmentModel } from '../models/department.model';
import { IReview, IReviewPart, ReviewModel } from '../models/review.model';
import { ICycleQuestion, IReviewCycle, ReviewCycleModel } from '../models/reviewCycle.model';
import { IUser, UserModel } from '../models/user.model';
import { ApiError } from '../utils/apiResponse';
import { effectiveJoiningDate } from './people.service';

type Id = Types.ObjectId | string;
const oid = (id: Id) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

export type Actor = { id: string; role: string };

/**
 * How the actor relates to someone's performance data (P3): it's theirs, they're the
 * person's direct manager (live `reportsTo`), or an ORG_ADMIN. Anyone else, including a
 * skip-level manager, has no access.
 */
export type Relation = 'owner' | 'manager' | 'admin' | 'none';

export async function relationTo(organizationId: Id, actor: Actor, ownerId: Id): Promise<Relation> {
  if (String(ownerId) === actor.id) return 'owner';
  const owner = await UserModel.findOne({ _id: ownerId, organizationId: oid(organizationId), isDeleted: false }, { reportsTo: 1 });
  if (!owner) return 'none';
  if (owner.reportsTo && String(owner.reportsTo) === actor.id) return 'manager';
  return actor.role === 'ORG_ADMIN' ? 'admin' : 'none';
}

/** A goal the actor may see, with how they relate to it; anyone else gets 404, so it isn't revealed. */
export async function goalForActor(organizationId: Id, goalId: string, actor: Actor): Promise<{ goal: IGoal; relation: Exclude<Relation, 'none'> }> {
  const goal = Types.ObjectId.isValid(goalId) ? await GoalModel.findOne({ _id: goalId, organizationId: oid(organizationId), isDeleted: false }) : null;
  const relation = goal ? await relationTo(organizationId, actor, goal.ownerId) : 'none';
  if (!goal || relation === 'none') throw new ApiError(404, 'Goal not found');
  return { goal, relation };
}

/** The people whose goals the actor may set: themselves, their active direct reports, or (admin) any active member. */
export async function goalOwnerFor(organizationId: Id, actor: Actor, ownerId: string | undefined): Promise<IUser> {
  const id = ownerId ?? actor.id;
  const owner = await UserModel.findOne({
    _id: id,
    organizationId: oid(organizationId),
    role: { $in: ['ORG_ADMIN', 'ORG_USER'] },
    status: 'active',
    isDeleted: false,
  });
  if (!owner) throw new ApiError(404, 'Employee not found');
  const relation = await relationTo(organizationId, actor, owner._id as Types.ObjectId);
  if (relation === 'none') throw new ApiError(403, 'You can set goals for yourself and your direct reports');
  return owner;
}

/** My direct reports (active), the "team" a manager sees. */
export function directReports(organizationId: Id, managerId: string): Promise<IUser[]> {
  return UserModel.find({ organizationId: oid(organizationId), reportsTo: oid(managerId), status: 'active', isDeleted: false }).sort({ name: 1 });
}

// ---------------------------------------------------------------- review cycles

/** Default 6: editable per cycle before launch. */
export const DEFAULT_QUESTIONS = [
  'What did you achieve this period?',
  'What could have gone better?',
  'What will you focus on next period?',
];

/** Questions ready to store: each keeps its id, or gets a new one. */
export function withQuestionIds(questions: { id?: string; text: string }[]): ICycleQuestion[] {
  const seen = new Set<string>();
  return questions.map((q) => {
    const id = q.id && !seen.has(q.id) ? q.id : new Types.ObjectId().toString();
    seen.add(id);
    return { id, text: q.text };
  });
}

type CycleShape = Pick<IReviewCycle, 'periodFrom' | 'periodTo' | 'selfDueDate' | 'managerDueDate' | 'scope'> & { departmentIds: (Types.ObjectId | string)[] };

/** The dates in order, and departments when the cycle is scoped to some (in this organization). */
export async function assertCycleShape(organizationId: Id, v: CycleShape): Promise<void> {
  const fieldErrors: Record<string, string[]> = {};
  if (v.periodTo < v.periodFrom) fieldErrors.periodTo = ['The period can’t end before it starts'];
  if (v.selfDueDate < v.periodFrom) fieldErrors.selfDueDate = ['Due on or after the start of the period'];
  if (v.managerDueDate < v.selfDueDate) fieldErrors.managerDueDate = ['Due on or after the self review'];
  if (v.scope === 'departments') {
    if (!v.departmentIds.length) {
      fieldErrors.departmentIds = ['Choose at least one department'];
    } else {
      const found = await DepartmentModel.countDocuments({ _id: { $in: v.departmentIds.map((d) => oid(d)) }, organizationId: oid(organizationId) });
      if (found !== new Set(v.departmentIds.map(String)).size) fieldErrors.departmentIds = ['Choose departments of your organization'];
    }
  }
  if (Object.keys(fieldErrors).length) throw new ApiError(400, 'Validation failed', { fieldErrors });
}

export async function cycleForAdmin(organizationId: Id, cycleId: string): Promise<IReviewCycle> {
  const cycle = Types.ObjectId.isValid(cycleId) ? await ReviewCycleModel.findOne({ _id: cycleId, organizationId: oid(organizationId), isDeleted: false }) : null;
  if (!cycle) throw new ApiError(404, 'Review cycle not found');
  return cycle;
}

/**
 * Who takes part (Default 5): active members who joined by the end of the period, in the
 * chosen departments if scoped. Each one's reviewer is their active manager now, else null
 * (any ORG_ADMIN, P2).
 */
export async function participantsFor(organizationId: Id, cycle: IReviewCycle): Promise<{ employee: IUser; reviewerId: Types.ObjectId | null }[]> {
  const members = await UserModel.find({
    organizationId: oid(organizationId),
    role: { $in: ['ORG_ADMIN', 'ORG_USER'] },
    status: 'active',
    isDeleted: false,
    ...(cycle.scope === 'departments' ? { department: { $in: cycle.departmentIds } } : {}),
  });
  const joined = members.filter((m) => effectiveJoiningDate(m) <= cycle.periodTo);
  const active = new Set(
    (await UserModel.find({ organizationId: oid(organizationId), role: { $in: ['ORG_ADMIN', 'ORG_USER'] }, status: 'active', isDeleted: false }, { _id: 1 })).map((u) =>
      String(u._id)
    )
  );
  return joined.map((employee) => ({
    employee,
    reviewerId: employee.reportsTo && active.has(String(employee.reportsTo)) ? (employee.reportsTo as Types.ObjectId) : null,
  }));
}

/** Reviews can be written while the cycle is launched or released; not in a draft or closed cycle. */
export function assertWritable(cycle: IReviewCycle): void {
  if (cycle.status === 'closed') throw new ApiError(409, 'This review cycle is closed');
  if (cycle.status === 'draft') throw new ApiError(409, 'This review cycle hasn’t been launched');
}

// ---------------------------------------------------------------- reviews

/**
 * How the actor relates to a review: the person reviewed (even an ORG_ADMIN: they don't see
 * their own manager review early), its reviewer, or an ORG_ADMIN. Anyone else: 404.
 */
export type ReviewRole = 'employee' | 'reviewer' | 'admin';

export async function reviewForActor(organizationId: Id, reviewId: string, actor: Actor): Promise<{ review: IReview; cycle: IReviewCycle; role: ReviewRole }> {
  const review = Types.ObjectId.isValid(reviewId) ? await ReviewModel.findOne({ _id: reviewId, organizationId: oid(organizationId) }) : null;
  const cycle = review ? await ReviewCycleModel.findOne({ _id: review.cycleId, isDeleted: false }) : null;
  const role: ReviewRole | null = !review
    ? null
    : String(review.employeeId) === actor.id
      ? 'employee'
      : review.reviewerId && String(review.reviewerId) === actor.id
        ? 'reviewer'
        : actor.role === 'ORG_ADMIN'
          ? 'admin'
          : null;
  if (!review || !cycle || !role) throw new ApiError(404, 'Review not found');
  return { review, cycle, role };
}

/** Who writes the manager part: the reviewer; or any ORG_ADMIN when there's none (never the person reviewed). */
export function canWriteManager(review: IReview, role: ReviewRole): boolean {
  return role === 'reviewer' || (role === 'admin' && !review.reviewerId);
}

export type PartStatus = 'not_started' | 'draft' | 'submitted';

export function partStatus(part: IReviewPart): PartStatus {
  if (part.submittedAt) return 'submitted';
  return part.savedAt ? 'draft' : 'not_started';
}

/** Every question answered and a rating chosen, or a 400 saying what's missing. */
export function assertComplete(questions: ICycleQuestion[], input: { answers: { questionId: string; text: string }[]; rating: number | null }): void {
  const fieldErrors: Record<string, string[]> = {};
  const answered = new Map(input.answers.map((a) => [a.questionId, a.text.trim()]));
  const missing = questions.filter((q) => !answered.get(q.id)).length;
  if (missing) fieldErrors.answers = [`Answer every question (${missing} left)`];
  if (input.rating == null) fieldErrors.rating = ['Choose a rating from 1 to 5'];
  if (Object.keys(fieldErrors).length) throw new ApiError(400, 'Validation failed', { fieldErrors });
}

/** Only answers to this cycle's questions are kept, in question order. */
export function cleanAnswers(questions: ICycleQuestion[], answers: { questionId: string; text: string }[]): { questionId: string; text: string }[] {
  const byId = new Map(answers.map((a) => [a.questionId, a.text]));
  return questions.filter((q) => byId.has(q.id)).map((q) => ({ questionId: q.id, text: byId.get(q.id)! }));
}

/** The person's goals that overlap the review period (Default 11). */
export function goalsInPeriod(organizationId: Id, employeeId: Id, cycle: Pick<IReviewCycle, 'periodFrom' | 'periodTo'>): Promise<IGoal[]> {
  return GoalModel.find({
    organizationId: oid(organizationId),
    ownerId: oid(employeeId),
    isDeleted: false,
    startDate: { $lte: cycle.periodTo },
    dueDate: { $gte: cycle.periodFrom },
  }).sort({ dueDate: 1, _id: 1 });
}
