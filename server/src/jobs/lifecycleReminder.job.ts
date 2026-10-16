import cron from 'node-cron';
import { Types } from 'mongoose';
import { LifecycleProcessModel } from '../models/lifecycleProcess.model';
import { ILifecycleTask, LifecycleTaskModel } from '../models/lifecycleTask.model';
import { OrganizationModel } from '../models/organization.model';
import { IUser, UserModel } from '../models/user.model';
import { mailerService } from '../services/mailer.service';
import { formatDates, notify, snippet } from '../services/notification.service';
import { addDays, todayIso } from '../utils/dates';

/**
 * The daily digest: everyone with pending onboarding/offboarding tasks due tomorrow or
 * overdue gets one notification and one email listing them. A task whose assignee has
 * left goes to the organization's admins.
 *
 * Once a day per task: each task is claimed by setting `lastRemindedOn` to today in one
 * atomic update, so a second run the same day (or two at once) can't repeat it. Only
 * running processes of organizations with an active plan are included.
 *
 * Returns how many people were reminded.
 */
export async function runLifecycleReminders(today: string = todayIso(), now: Date = new Date()): Promise<number> {
  const tomorrow = addDays(today, 1);
  const candidates = await LifecycleTaskModel.find({ status: 'pending', dueDate: { $lte: tomorrow }, lastRemindedOn: { $ne: today } }, { _id: 1, processId: 1 });
  if (!candidates.length) return 0;

  const running = await LifecycleProcessModel.find({ _id: { $in: [...new Set(candidates.map((t) => String(t.processId)))] }, status: 'active' });
  const paying = new Set(
    (await OrganizationModel.find({ _id: { $in: running.map((p) => p.organizationId) }, planActive: true, expiryDate: { $gt: now } }, { _id: 1 })).map((o) =>
      String(o._id)
    )
  );
  const processes = new Map(running.filter((p) => paying.has(String(p.organizationId))).map((p) => [String(p._id), p]));

  const claimed: ILifecycleTask[] = [];
  for (const candidate of candidates) {
    if (!processes.has(String(candidate.processId))) continue;
    const task = await LifecycleTaskModel.findOneAndUpdate(
      { _id: candidate._id, status: 'pending', lastRemindedOn: { $ne: today } },
      { $set: { lastRemindedOn: today } },
      { returnDocument: 'after' }
    );
    if (task) claimed.push(task);
  }
  if (!claimed.length) return 0;

  // Everyone involved: assignees, the people whose processes these are, and the admins.
  const orgIds = [...new Set(claimed.map((t) => String(t.organizationId)))];
  const people = await UserModel.find({
    $or: [
      { _id: { $in: claimed.flatMap((t) => [t.assigneeId, t.employeeId]).filter(Boolean) } },
      { organizationId: { $in: orgIds }, role: 'ORG_ADMIN', status: 'active', isDeleted: false },
    ],
  });
  const byId = new Map(people.map((p) => [String(p._id), p]));
  const isActive = (u: IUser | undefined) => Boolean(u && u.status === 'active' && !u.isDeleted);
  const adminsOf = (orgId: string) => people.filter((p) => String(p.organizationId) === orgId && p.role === 'ORG_ADMIN' && isActive(p));

  const digests = new Map<string, ILifecycleTask[]>();
  for (const task of claimed) {
    const assignee = task.assigneeId ? byId.get(String(task.assigneeId)) : undefined;
    const recipients = isActive(assignee) ? [assignee!] : adminsOf(String(task.organizationId));
    for (const r of recipients) digests.set(String(r._id), [...(digests.get(String(r._id)) ?? []), task]);
  }

  for (const [userId, tasks] of digests) {
    const user = byId.get(userId)!;
    tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const items = tasks.map((t) => ({
      title: t.title,
      whose: String(t.employeeId) === userId ? `your ${t.kind}` : `${byId.get(String(t.employeeId))?.name ?? 'someone'}'s ${t.kind}`,
      due: formatDates(t.dueDate),
      overdue: t.dueDate < today,
    }));
    const overdue = items.filter((i) => i.overdue).length;
    await notify(user.organizationId as Types.ObjectId, [userId], {
      type: 'lifecycle_reminder',
      title:
        overdue === tasks.length
          ? `${tasks.length} onboarding/offboarding task${tasks.length === 1 ? ' is' : 's are'} overdue`
          : `${tasks.length} onboarding/offboarding task${tasks.length === 1 ? ' needs' : 's need'} you${overdue ? ` (${overdue} overdue)` : ''}`,
      body: snippet(items.map((i) => `${i.title} (${i.whose})`).join(', '), 200),
      link: '/home',
    });
    await mailerService.sendLifecycleDigestEmail(user.email, { items });
  }
  return digests.size;
}

/** Daily at 09:00 IST, inside the API process (fine for a single instance). */
export function startLifecycleReminderJob(): void {
  cron.schedule(
    '0 9 * * *',
    () => {
      runLifecycleReminders()
        .then((count) => {
          if (count > 0) console.log(`[job] Sent onboarding/offboarding reminders to ${count} people`);
        })
        .catch((err) => console.error('[job] Onboarding/offboarding reminders failed', err));
    },
    { timezone: 'Asia/Kolkata' }
  );
}
