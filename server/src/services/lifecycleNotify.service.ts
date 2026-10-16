import { Types } from 'mongoose';
import { ILifecycleProcess, LifecycleProcessModel } from '../models/lifecycleProcess.model';
import { ILifecycleTask, LifecycleTaskModel } from '../models/lifecycleTask.model';
import { IUser, UserModel } from '../models/user.model';
import { addDays, todayIso } from '../utils/dates';
import { mailerService } from './mailer.service';
import { formatDates, notify, snippet } from './notification.service';

type Id = Types.ObjectId | string;

/** Assignees with tasks due within this many days get an email when a process starts. */
export const EMAIL_IF_DUE_WITHIN_DAYS = 3;

/** Where admins open a process (the People ops pages). */
export function processLink(process: Pick<ILifecycleProcess, '_id' | 'kind'>): string {
  return `/people-ops/${process.kind}?process=${String(process._id)}`;
}

function activeAdmins(organizationId: Id): Promise<IUser[]> {
  return UserModel.find({ organizationId, role: 'ORG_ADMIN', status: 'active', isDeleted: false });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Who does each task: its assignee, or every active ORG_ADMIN for the admins' tasks.
 * Returns each recipient with their tasks (someone who is both gets both).
 */
async function byRecipient(organizationId: Id, tasks: ILifecycleTask[]): Promise<Map<string, ILifecycleTask[]>> {
  const admins = tasks.some((t) => !t.assigneeId) ? await activeAdmins(organizationId) : [];
  const out = new Map<string, ILifecycleTask[]>();
  for (const task of tasks) {
    const recipients = task.assigneeId ? [String(task.assigneeId)] : admins.map((a) => String(a._id));
    for (const r of recipients) out.set(r, [...(out.get(r) ?? []), task]);
  }
  return out;
}

/**
 * A process started: each person with tasks gets one notification ("3 onboarding tasks for
 * Ivy Mehta"), and an email if any of theirs is due within 3 days. The buddy is told
 * they've been picked. Nobody hears about their own action.
 */
export async function announceStart(process: ILifecycleProcess, actorId: string): Promise<void> {
  const employee = await UserModel.findById(process.employeeId);
  if (!employee) return;
  const tasks = await LifecycleTaskModel.find({ processId: process._id, status: 'pending' }).sort({ dueDate: 1, order: 1 });
  const recipients = await byRecipient(process.organizationId, tasks);
  const users = await UserModel.find({ _id: { $in: [...recipients.keys()] }, status: 'active', isDeleted: false });
  const soon = addDays(todayIso(), EMAIL_IF_DUE_WITHIN_DAYS);

  for (const user of users) {
    const id = String(user._id);
    if (id === actorId) continue;
    const theirs = recipients.get(id)!;
    const isOwn = id === String(process.employeeId);
    const title = isOwn
      ? process.kind === 'onboarding'
        ? `Welcome aboard! You have ${plural(theirs.length, 'onboarding task')}`
        : `Your offboarding has started: ${plural(theirs.length, 'task')}`
      : `${plural(theirs.length, `${process.kind} task`)} for ${employee.name}`;
    await notify(process.organizationId, [id], {
      type: 'lifecycle_started',
      title,
      body: snippet(theirs.map((t) => t.title).join(', ')),
      link: '/home',
    });
    if (theirs.some((t) => t.dueDate <= soon)) {
      await mailerService.sendLifecycleTasksEmail(user.email, {
        employeeName: employee.name,
        kind: process.kind,
        isOwn,
        tasks: theirs.map((t) => ({ title: t.title, due: formatDates(t.dueDate) })),
      });
    }
  }

  if (process.buddyId) {
    await notify(
      process.organizationId,
      [process.buddyId],
      {
        type: 'lifecycle_buddy',
        title: `You're ${employee.name}'s buddy`,
        body: `They join on ${formatDates(process.anchorDate)}. Help them settle in during their first weeks.`,
        link: '/home',
      },
      actorId
    );
  }
}

/** Someone was given a task (reassigned, or an ad-hoc one): tell them. The admins' tasks aren't announced. */
export async function announceAssigned(task: ILifecycleTask, actorId: string): Promise<void> {
  if (!task.assigneeId) return;
  const employee = await UserModel.findById(task.employeeId);
  const whose = String(task.assigneeId) === String(task.employeeId) ? `your ${task.kind}` : `${employee?.name ?? 'someone'}'s ${task.kind}`;
  await notify(
    task.organizationId,
    [task.assigneeId],
    { type: 'lifecycle_assigned', title: `New task for ${whose}: ${task.title}`, body: `Due ${formatDates(task.dueDate)}`, link: '/home' },
    actorId
  );
}

/**
 * Once nothing is pending, the admins are told it's ready to complete: once, even if the
 * last two tasks finish together (the flag is claimed atomically).
 */
export async function announceReadyIfDone(processId: Id, actorId: string): Promise<void> {
  if (await LifecycleTaskModel.exists({ processId, status: 'pending' })) return;
  const process = await LifecycleProcessModel.findOneAndUpdate(
    { _id: processId, status: 'active', readyNotifiedAt: null },
    { $set: { readyNotifiedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!process) return;
  const employee = await UserModel.findById(process.employeeId);
  const admins = await activeAdmins(process.organizationId);
  const total = await LifecycleTaskModel.countDocuments({ processId });
  await notify(
    process.organizationId,
    admins.map((a) => a._id as Types.ObjectId),
    {
      type: 'lifecycle_ready',
      title: `${employee?.name ?? 'Someone'}'s ${process.kind} is ready to complete`,
      body:
        process.kind === 'offboarding'
          ? `All ${plural(total, 'task')} are done or skipped. Completing it disables their account.`
          : `All ${plural(total, 'task')} are done or skipped.`,
      link: processLink(process),
    },
    actorId
  );
}

/** A task was added, so "ready" may be announced again later. */
export async function resetReady(processId: Id): Promise<void> {
  await LifecycleProcessModel.updateOne({ _id: processId }, { $set: { readyNotifiedAt: null } });
}
