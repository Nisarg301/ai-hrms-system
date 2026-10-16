import cron from 'node-cron';
import { Types } from 'mongoose';
import { PLAN_FEATURES } from '../constants/modules';
import { OrganizationModel } from '../models/organization.model';
import { IReview, ReviewModel, ReviewPart } from '../models/review.model';
import { IReviewCycle, ReviewCycleModel } from '../models/reviewCycle.model';
import { IUser, UserModel } from '../models/user.model';
import { mailerService } from '../services/mailer.service';
import { formatDates, notify, snippet } from '../services/notification.service';
import { reviewLink } from '../services/performanceNotify.service';
import { addDays, todayIso } from '../utils/dates';

/** Reminders go out this many days before a due date, and on the day (Default 12). */
export const REMIND_DAYS_BEFORE = 2;

type Item = { label: string; due: string; link: string };

/**
 * The daily review reminder: everyone with a self or manager part due today or in two days,
 * still not submitted, gets one notification and one email listing them. A manager part
 * without a reviewer (or whose reviewer has left) goes to the organization's admins.
 *
 * Once a day per part: `remindedOn` is claimed atomically, so a second run the same day
 * repeats nothing. Only open cycles of organizations whose active plan includes Performance.
 *
 * Returns how many people were reminded.
 */
export async function runPerformanceReminders(today: string = todayIso(), now: Date = new Date()): Promise<number> {
  const days = [today, addDays(today, REMIND_DAYS_BEFORE)];
  const cycles = await ReviewCycleModel.find({
    status: { $in: ['launched', 'released'] },
    isDeleted: false,
    $or: [{ selfDueDate: { $in: days } }, { managerDueDate: { $in: days } }],
  });
  if (!cycles.length) return 0;
  const orgs = await OrganizationModel.find({ _id: { $in: cycles.map((c) => c.organizationId) }, planActive: true, expiryDate: { $gt: now } });
  const entitled = new Set(orgs.filter((o) => o.planType && (PLAN_FEATURES[o.planType] as readonly string[]).includes('performance')).map((o) => String(o._id)));

  const digests = new Map<string, Item[]>();
  const add = (userId: string, item: Item) => digests.set(userId, [...(digests.get(userId) ?? []), item]);
  const due = (date: string) => (date === today ? 'due today' : `due ${formatDates(date)}`);

  for (const cycle of cycles.filter((c) => entitled.has(String(c.organizationId)))) {
    const members = await UserModel.find({ organizationId: cycle.organizationId, isDeleted: false });
    const byId = new Map(members.map((m) => [String(m._id), m]));
    const isActive = (u: IUser | undefined) => Boolean(u && u.status === 'active');
    const admins = members.filter((m) => m.role === 'ORG_ADMIN' && isActive(m));

    for (const part of ['self', 'manager'] as ReviewPart[]) {
      const dueDate = part === 'self' ? cycle.selfDueDate : cycle.managerDueDate;
      if (!days.includes(dueDate)) continue;
      for (const review of await claim(cycle, part, today)) {
        const employee = byId.get(String(review.employeeId));
        if (part === 'self') {
          if (isActive(employee)) add(String(review.employeeId), { label: `Your ${cycle.name} self review`, due: due(dueDate), link: reviewLink(review) });
          continue;
        }
        const reviewer = review.reviewerId ? byId.get(String(review.reviewerId)) : undefined;
        const writers = isActive(reviewer) ? [reviewer!] : admins.filter((a) => String(a._id) !== String(review.employeeId));
        for (const w of writers) {
          add(String(w._id), { label: `Manager review of ${employee?.name ?? 'a former member'} (${cycle.name})`, due: due(dueDate), link: reviewLink(review) });
        }
      }
    }
  }

  const people = await UserModel.find({ _id: { $in: [...digests.keys()].map((id) => new Types.ObjectId(id)) } });
  for (const user of people) {
    const items = digests.get(String(user._id))!;
    await notify(user.organizationId as Types.ObjectId, [user._id as Types.ObjectId], {
      type: 'review_reminder',
      title: `${items.length} review${items.length === 1 ? '' : 's'} to finish`,
      body: snippet(items.map((i) => `${i.label} (${i.due})`).join(', '), 200),
      link: items.length === 1 ? items[0].link : '/me/performance',
    });
    await mailerService.sendPerformanceDigestEmail(user.email, { items: items.map(({ label, due: d }) => ({ label, due: d })) });
  }
  return people.length;
}

/** The cycle's unsubmitted parts not yet reminded today, each claimed in one atomic update. */
async function claim(cycle: IReviewCycle, part: ReviewPart, today: string): Promise<IReview[]> {
  const candidates = await ReviewModel.find({ cycleId: cycle._id, [`${part}.submittedAt`]: null, [`${part}.remindedOn`]: { $ne: today } }, { _id: 1 });
  const claimed: IReview[] = [];
  for (const c of candidates) {
    const review = await ReviewModel.findOneAndUpdate(
      { _id: c._id, [`${part}.submittedAt`]: null, [`${part}.remindedOn`]: { $ne: today } },
      { $set: { [`${part}.remindedOn`]: today } },
      { returnDocument: 'after' }
    );
    if (review) claimed.push(review);
  }
  return claimed;
}

/** Daily at 09:00 IST, inside the API process (fine for a single instance). */
export function startPerformanceReminderJob(): void {
  cron.schedule(
    '0 9 * * *',
    () => {
      runPerformanceReminders()
        .then((count) => {
          if (count > 0) console.log(`[job] Sent review reminders to ${count} people`);
        })
        .catch((err) => console.error('[job] Review reminders failed', err));
    },
    { timezone: 'Asia/Kolkata' }
  );
}
