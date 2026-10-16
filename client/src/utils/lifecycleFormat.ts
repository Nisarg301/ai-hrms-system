import dayjs from 'dayjs';
import type { ChecklistTaskType, LifecycleKind, LifecycleTask, OffboardingReason } from '../types/lifecycle';

/** Onboarding is for new joiners: joining later, or at most this many days ago (the server's rule). */
export const ONBOARDING_WINDOW_DAYS = 30;

/** A chip for tasks that need more than a tick. */
export const TASK_TYPE_LABEL: Record<ChecklistTaskType, string | null> = {
  task: null,
  upload: 'Upload',
  acknowledge: 'Read & confirm',
  form: 'Form',
};

export const KIND_LABEL: Record<LifecycleKind, string> = { onboarding: 'Onboarding', offboarding: 'Offboarding' };

/** "Mon, 12 Oct" */
export function shortDate(iso: string): string {
  return dayjs(iso).format('ddd, D MMM');
}

/** "Due Mon, 12 Oct", "Due today", "Overdue · Sat, 10 Oct", or how it ended. */
export function dueText(task: Pick<LifecycleTask, 'status' | 'dueDate' | 'overdue'>, today: string): string {
  if (task.status === 'done') return 'Done';
  if (task.status === 'skipped') return 'Skipped';
  if (task.overdue) return `Overdue · ${shortDate(task.dueDate)}`;
  if (task.dueDate === today) return 'Due today';
  return `Due ${shortDate(task.dueDate)}`;
}

/** Days from `today` to `date` (negative = already past). */
export function daysFrom(today: string, date: string): number {
  return dayjs(date).diff(dayjs(today), 'day');
}

/** Whose task it is, from the doer's side: "Your onboarding" or "Ivy Mehta's onboarding". */
export function whose(kind: LifecycleKind, employeeName: string | null, isMine: boolean): string {
  return isMine ? `Your ${kind}` : `${employeeName ?? 'Someone'}'s ${kind}`;
}

/** Share of tasks that are finished (done or skipped), 0–100. */
export function percentFinished(progress: { total: number; done: number; skipped: number }): number {
  return progress.total ? Math.round(((progress.done + progress.skipped) / progress.total) * 100) : 0;
}

export const REASON_LABEL: Record<OffboardingReason, string> = {
  resignation: 'Resignation',
  termination: 'Termination',
  end_of_contract: 'End of contract',
  other: 'Other',
};

/** Who a task is for, as an admin reads it: "Mia Shah (manager)", "Admins". */
export function assigneeText(task: Pick<LifecycleTask, 'assigneeKind' | 'assigneeName' | 'assigneeId'>): string {
  if (!task.assigneeId) return 'Admins';
  const role = { employee: 'employee', manager: 'manager', buddy: 'buddy', person: null, admin: null }[task.assigneeKind];
  return role ? `${task.assigneeName} (${role})` : (task.assigneeName ?? 'Former member');
}

/** "2 days before", "on the day", "30 days after". */
export function offsetText(days: number, kind: LifecycleKind): string {
  const anchor = kind === 'onboarding' ? 'joining' : 'the last day';
  if (days === 0) return kind === 'onboarding' ? 'On the joining day' : 'On the last day';
  const n = Math.abs(days);
  return `${n} day${n === 1 ? '' : 's'} ${days < 0 ? 'before' : 'after'} ${anchor}`;
}
