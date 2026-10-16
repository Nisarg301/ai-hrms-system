import { Types } from 'mongoose';
import { IReview, ReviewModel } from '../models/review.model';
import { IReviewCycle } from '../models/reviewCycle.model';
import { IUser, UserModel } from '../models/user.model';
import { formatDates, notify, snippet } from './notification.service';

/** Where a review opens (Me → Performance). */
export function reviewLink(review: Pick<IReview, '_id'>): string {
  return `/me/performance?review=${String(review._id)}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function activeAdmins(organizationId: Types.ObjectId): Promise<IUser[]> {
  return UserModel.find({ organizationId, role: 'ORG_ADMIN', status: 'active', isDeleted: false });
}

/** Who writes a review's manager part: its reviewer, or (none) every active admin except the person reviewed. */
function writersOf(review: IReview, admins: IUser[]): string[] {
  if (review.reviewerId) return [String(review.reviewerId)];
  return admins.map((a) => String(a._id)).filter((id) => id !== String(review.employeeId));
}

/**
 * A cycle launched: each participant hears their self review is open, and each person with
 * manager reviews to write gets one notification listing whose. Nobody hears about their own action.
 */
export async function announceLaunch(cycle: IReviewCycle, actorId: string): Promise<void> {
  const reviews = await ReviewModel.find({ cycleId: cycle._id });
  const people = new Map((await UserModel.find({ _id: { $in: reviews.map((r) => r.employeeId) } }, { name: 1 })).map((u) => [String(u._id), u.name]));
  for (const r of reviews) {
    await notify(
      cycle.organizationId,
      [r.employeeId],
      { type: 'review_launched', title: `Your ${cycle.name} self review is open`, body: `Due ${formatDates(cycle.selfDueDate)}`, link: reviewLink(r) },
      actorId
    );
  }
  const admins = reviews.some((r) => !r.reviewerId) ? await activeAdmins(cycle.organizationId) : [];
  const toWrite = new Map<string, IReview[]>();
  for (const r of reviews) {
    for (const writer of writersOf(r, admins)) toWrite.set(writer, [...(toWrite.get(writer) ?? []), r]);
  }
  for (const [writer, theirs] of toWrite) {
    await notify(
      cycle.organizationId,
      [writer],
      {
        type: 'review_launched',
        title: `${plural(theirs.length, 'manager review')} to write for ${cycle.name}`,
        body: snippet(
          `${theirs
            .map((r) => people.get(String(r.employeeId)) ?? 'Someone')
            .sort((a, b) => a.localeCompare(b))
            .join(', ')}. Due ${formatDates(cycle.managerDueDate)}.`,
          200
        ),
        link: '/me/performance',
      },
      actorId
    );
  }
}

/** A new reviewer is told whose review they now write. */
export async function announceAssigned(review: IReview, cycle: IReviewCycle, actorId: string): Promise<void> {
  if (!review.reviewerId) return;
  const employee = await UserModel.findById(review.employeeId, { name: 1 });
  await notify(
    cycle.organizationId,
    [review.reviewerId],
    {
      type: 'review_assigned',
      title: `You're reviewing ${employee?.name ?? 'someone'} for ${cycle.name}`,
      body: `The manager review is due ${formatDates(cycle.managerDueDate)}`,
      link: reviewLink(review),
    },
    actorId
  );
}

/** The self review is in: whoever writes the manager part can read it now. */
export async function announceSelfSubmitted(review: IReview, cycle: IReviewCycle, actorId: string): Promise<void> {
  const employee = await UserModel.findById(review.employeeId, { name: 1 });
  const admins = review.reviewerId ? [] : await activeAdmins(cycle.organizationId);
  await notify(
    cycle.organizationId,
    writersOf(review, admins),
    {
      type: 'review_submitted',
      title: `${employee?.name ?? 'Someone'} submitted a self review for ${cycle.name}`,
      body: review.manager.submittedAt ? 'You have already submitted the manager review.' : `The manager review is due ${formatDates(cycle.managerDueDate)}`,
      link: reviewLink(review),
    },
    actorId
  );
}

/** Released reviews: each person can read their manager's review now. */
export async function announceReleased(reviews: IReview[], cycle: IReviewCycle, actorId: string): Promise<void> {
  for (const r of reviews) {
    await notify(
      cycle.organizationId,
      [r.employeeId],
      { type: 'review_released', title: `Your ${cycle.name} review is ready`, body: 'Your manager’s review is now visible.', link: reviewLink(r) },
      actorId
    );
  }
}
