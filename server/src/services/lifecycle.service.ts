import { Request } from 'express';
import { Types } from 'mongoose';
import {
  AssigneeKind,
  ChecklistTaskType,
  ChecklistTemplateModel,
  IChecklistTemplate,
  ITemplateTask,
  LifecycleKind,
} from '../models/checklistTemplate.model';
import { ILifecycleProcess, LifecycleProcessModel, OffboardingReason } from '../models/lifecycleProcess.model';
import { ILifecycleTask, LifecycleTaskModel } from '../models/lifecycleTask.model';
import { IUser, UserModel } from '../models/user.model';
import { ApiError } from '../utils/apiResponse';
import { auditCrud } from './audit.service';
import { addDays } from '../utils/dates';
import { formatDates } from './notification.service';
import { effectiveJoiningDate } from './people.service';
import type { TemplateTaskInput } from '../validators/lifecycle.validators';

type Id = Types.ObjectId | string;
const oid = (id: Id) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

export function fieldError(field: string, message: string): ApiError {
  return new ApiError(400, message, { fieldErrors: { [field]: [message] } });
}

// ---------------------------------------------------------------- templates

type SeedTask = [title: string, assignee: AssigneeKind, dueOffsetDays: number, type: ChecklistTaskType, extra?: { instructions?: string; questions?: string[]; link?: string }];

const EXIT_INTERVIEW = [
  'Why did you decide to leave?',
  'What did you enjoy most about working here?',
  'What could we have done better?',
  'Would you recommend us as a place to work? Why or why not?',
];

/** Spec default 3: fully editable once seeded. */
const DEFAULT_TEMPLATES: { name: string; kind: LifecycleKind; tasks: SeedTask[] }[] = [
  {
    name: 'Standard onboarding',
    kind: 'onboarding',
    tasks: [
      ['Create email and system accounts', 'admin', -2, 'task', { instructions: 'Set up their work email and the tools they need from day one.' }],
      ['Prepare laptop', 'admin', -1, 'task', { instructions: 'Set it up, and have it ready at their desk or couriered in time.' }],
      ['Assign a buddy', 'manager', -1, 'task', { instructions: 'Pick a teammate to show them around in their first weeks.' }],
      ['Upload ID and address proof', 'employee', 0, 'upload', { instructions: 'A government ID (Aadhaar, PAN or passport) and a recent address proof, as PDF, JPG or PNG.' }],
      ['Introduce yourself', 'employee', 1, 'task', { instructions: 'Say hello to everyone on the Welcome tab.', link: '/home?tab=welcome' }],
      ['Read the company policies', 'employee', 3, 'acknowledge', { instructions: 'Read the policies your admin shared with you, then tick “I’ve read this”.' }],
      ['First 1:1 meeting', 'manager', 1, 'task', { instructions: 'Meet one to one: expectations, first goals, and how you’ll work together.' }],
      ['30-day check-in', 'manager', 30, 'task', { instructions: 'How are the first weeks going? Agree on what to focus on next.' }],
    ],
  },
  {
    name: 'Standard offboarding',
    kind: 'offboarding',
    tasks: [
      ['Knowledge handover notes', 'employee', -7, 'upload', { instructions: 'Write down what you look after, where things are, and who takes over. Upload it as a PDF.' }],
      ['Exit interview', 'employee', -2, 'form', { instructions: 'Your answers are seen only by the admins, and help us improve.', questions: EXIT_INTERVIEW }],
      ['Return laptop and ID card', 'employee', 0, 'task', { instructions: 'Hand them to your admin on your last day.' }],
      ['Revoke system access', 'admin', 0, 'task', { instructions: 'Email, chat, code and any shared accounts.' }],
      ['Final settlement', 'admin', 15, 'task', { instructions: 'Salary for the days worked, leave encashment and any dues.' }],
      ['Experience and relieving letter', 'admin', 15, 'upload', { instructions: 'Upload the signed letters.' }],
    ],
  },
];

function seedTask([title, kind, dueOffsetDays, type, extra = {}]: SeedTask): ITemplateTask {
  return {
    key: new Types.ObjectId().toString(),
    title,
    instructions: extra.instructions ?? '',
    assignee: { kind, userId: null },
    dueOffsetDays,
    type,
    questions: extra.questions ?? [],
    link: extra.link ?? null,
  };
}

/**
 * Creates the two standard templates the first time an organization's templates are
 * used; never again (deleted ones count). Safe under concurrent first calls: the
 * unique name index turns the loser's insert into a harmless duplicate error.
 */
export async function ensureDefaultTemplates(organizationId: Id): Promise<void> {
  const org = oid(organizationId);
  if ((await ChecklistTemplateModel.countDocuments({ organizationId: org })) > 0) return;
  try {
    await ChecklistTemplateModel.insertMany(
      DEFAULT_TEMPLATES.map((t) => ({
        organizationId: org,
        name: t.name,
        nameKey: t.name.toLowerCase(),
        kind: t.kind,
        isDefault: true,
        tasks: t.tasks.map(seedTask),
      })),
      { ordered: false }
    );
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
  }
}

/**
 * Template tasks ready to store: every task gets a unique key, and a
 * named person must be an active member of the organization.
 */
export async function prepareTemplateTasks(organizationId: Id, tasks: TemplateTaskInput[]): Promise<ITemplateTask[]> {
  const personIds = [...new Set(tasks.filter((t) => t.assignee.kind === 'person').map((t) => t.assignee.userId!))];
  if (personIds.length) {
    const members = await UserModel.find(
      { _id: { $in: personIds.map((id) => oid(id)) }, organizationId: oid(organizationId), status: 'active', isDeleted: false },
      { _id: 1 }
    );
    const active = new Set(members.map((m) => String(m._id)));
    const i = tasks.findIndex((t) => t.assignee.kind === 'person' && !active.has(t.assignee.userId!));
    if (i >= 0) throw fieldError('tasks', `Task ${i + 1}: that person isn’t an active member of your organization`);
  }
  const seen = new Set<string>();
  return tasks.map((t) => {
    // A new task, or a repeated key (a copied row, say), gets a fresh one.
    const key = t.key && !seen.has(t.key) ? t.key : new Types.ObjectId().toString();
    seen.add(key);
    return {
      key,
      title: t.title,
      instructions: t.instructions,
      assignee: { kind: t.assignee.kind, userId: t.assignee.userId ? oid(t.assignee.userId) : null },
      dueOffsetDays: t.dueOffsetDays,
      type: t.type,
      questions: t.questions,
      link: t.link,
    };
  });
}

// ---------------------------------------------------------------- processes

/** How far ahead an offboarding's last working day can be. */
export const MAX_NOTICE_DAYS = 180;
/** Onboarding is for new joiners: joining later, or at most this many days ago. */
export const ONBOARDING_WINDOW_DAYS = 30;
/** At most this many files on one upload task. */
export const MAX_TASK_FILES = 5;

const KIND_LABEL: Record<LifecycleKind, string> = { onboarding: 'onboarding', offboarding: 'offboarding' };

/** An active ORG_ADMIN or ORG_USER of the organization, or null. */
export async function activeMember(organizationId: Id, userId: Id | null | undefined): Promise<IUser | null> {
  if (!userId || !Types.ObjectId.isValid(String(userId))) return null;
  return UserModel.findOne({ _id: userId, organizationId: oid(organizationId), role: { $in: ['ORG_ADMIN', 'ORG_USER'] }, status: 'active', isDeleted: false });
}

/** A live template of this kind in the organization, or a field error on `templateId`. */
export async function templateFor(organizationId: Id, templateId: string, kind: LifecycleKind): Promise<IChecklistTemplate> {
  const template = await ChecklistTemplateModel.findOne({ _id: templateId, organizationId: oid(organizationId), kind, isDeleted: false });
  if (!template) throw fieldError('templateId', `Choose an ${KIND_LABEL[kind]} template`);
  return template;
}

/** The buddy for `employeeId` (null while the employee is being created): an active member who isn't them. */
export async function checkBuddy(organizationId: Id, buddyId: string | null | undefined, employeeId: string | null): Promise<IUser | null> {
  if (!buddyId) return null;
  if (employeeId && buddyId === employeeId) throw fieldError('buddyId', 'Someone can’t be their own buddy');
  const buddy = await activeMember(organizationId, buddyId);
  if (!buddy) throw fieldError('buddyId', 'Choose an active member of your organization');
  return buddy;
}

/** A joining date recent enough for onboarding (today, later, or within the window). */
export function isRecentJoiningDate(joiningDate: string, today: string): boolean {
  return joiningDate >= addDays(today, -ONBOARDING_WINDOW_DAYS);
}

/**
 * Only new joiners are onboarded: not yourself, not someone who joined more than
 * ONBOARDING_WINDOW_DAYS ago, and not someone already onboarded (a cancelled one can restart).
 */
export async function assertCanOnboard(organizationId: Id, employee: IUser, actorId: string, today: string): Promise<void> {
  if (String(employee._id) === actorId) throw new ApiError(400, 'You can’t start your own onboarding. Ask another admin.');
  const joined = effectiveJoiningDate(employee);
  if (!isRecentJoiningDate(joined, today)) {
    throw new ApiError(400, `Onboarding is for new joiners. ${employee.name} joined on ${formatDates(joined)}.`);
  }
  if (await LifecycleProcessModel.exists({ organizationId: oid(organizationId), employeeId: employee._id, kind: 'onboarding', status: 'completed' })) {
    throw new ApiError(409, `${employee.name} has already been onboarded`);
  }
}

/**
 * Who a process can be started for, for the admin's picker: for onboarding, new joiners not
 * yet onboarded (or being onboarded); for offboarding, anyone not already leaving. Never yourself.
 */
export async function candidatesFor(organizationId: Id, kind: LifecycleKind, actorId: string, today: string): Promise<IUser[]> {
  const org = oid(organizationId);
  const members = await UserModel.find({ organizationId: org, role: { $in: ['ORG_ADMIN', 'ORG_USER'] }, status: 'active', isDeleted: false }).sort({ name: 1 });
  const taken = new Set(
    (
      await LifecycleProcessModel.find(
        { organizationId: org, kind, status: { $in: kind === 'onboarding' ? ['active', 'completed'] : ['active'] } },
        { employeeId: 1 }
      )
    ).map((p) => String(p.employeeId))
  );
  return members.filter(
    (m) => String(m._id) !== actorId && !taken.has(String(m._id)) && (kind === 'offboarding' || isRecentJoiningDate(effectiveJoiningDate(m), today))
  );
}

interface StartInput {
  organizationId: Id;
  employee: IUser;
  kind: LifecycleKind;
  template: IChecklistTemplate;
  anchorDate: string;
  buddy: IUser | null;
  reason?: OffboardingReason | null;
  adminNotes?: string;
  startedBy: string;
}

/**
 * Who does each template task, fixed now: the employee; their manager and a named
 * person if still active; the buddy. Anyone missing, and 'admin', is null: any ORG_ADMIN.
 */
async function assigneeResolver(input: StartInput): Promise<(t: ITemplateTask) => Types.ObjectId | null> {
  const { organizationId, employee, template, buddy } = input;
  const wanted = [
    ...(employee.reportsTo ? [employee.reportsTo] : []),
    ...template.tasks.filter((t) => t.assignee.kind === 'person' && t.assignee.userId).map((t) => t.assignee.userId!),
  ];
  const active = wanted.length
    ? new Set(
        (
          await UserModel.find(
            { _id: { $in: wanted }, organizationId: oid(organizationId), role: { $in: ['ORG_ADMIN', 'ORG_USER'] }, status: 'active', isDeleted: false },
            { _id: 1 }
          )
        ).map((u) => String(u._id))
      )
    : new Set<string>();
  const ifActive = (id: Types.ObjectId | null | undefined) => (id && active.has(String(id)) ? id : null);
  return (t) => {
    switch (t.assignee.kind) {
      case 'employee':
        return employee._id as Types.ObjectId;
      case 'manager':
        return ifActive(employee.reportsTo);
      case 'buddy':
        return buddy ? (buddy._id as Types.ObjectId) : null;
      case 'person':
        return ifActive(t.assignee.userId);
      default:
        return null;
    }
  };
}

/**
 * Starts a process: the process, then its tasks copied from the template with due dates
 * (anchor + offset) and assignees fixed. One active process per person per kind (409).
 * Without transactions, a failure writing the tasks removes the process again.
 */
export async function startProcess(input: StartInput): Promise<ILifecycleProcess> {
  const { organizationId, employee, kind, template, anchorDate, buddy } = input;
  const resolve = await assigneeResolver(input);
  let process: ILifecycleProcess;
  try {
    process = await LifecycleProcessModel.create({
      organizationId: oid(organizationId),
      employeeId: employee._id,
      kind,
      templateId: template._id,
      templateName: template.name,
      anchorDate,
      buddyId: buddy?._id ?? null,
      reason: input.reason ?? null,
      adminNotes: input.adminNotes ?? '',
      startedBy: oid(input.startedBy),
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, `${employee.name} already has an active ${KIND_LABEL[kind]}`);
    throw err;
  }
  try {
    await LifecycleTaskModel.insertMany(
      template.tasks.map((t, order) => ({
        organizationId: oid(organizationId),
        processId: process._id,
        employeeId: employee._id,
        kind,
        order,
        title: t.title,
        instructions: t.instructions,
        type: t.type,
        questions: t.questions,
        link: t.link,
        assigneeKind: t.assignee.kind,
        assigneeId: resolve(t),
        dueDate: addDays(anchorDate, t.dueOffsetDays),
      }))
    );
  } catch (err) {
    await LifecycleTaskModel.deleteMany({ processId: process._id });
    await LifecycleProcessModel.deleteOne({ _id: process._id });
    throw err;
  }
  return process;
}

/** A process of the organization, or 404. */
export async function findProcess(organizationId: Id, processId: string): Promise<ILifecycleProcess> {
  const process = await LifecycleProcessModel.findOne({ _id: processId, organizationId: oid(organizationId) });
  if (!process) throw new ApiError(404, 'Process not found');
  return process;
}

export function assertActive(process: ILifecycleProcess): void {
  if (process.status !== 'active') throw new ApiError(409, `This ${KIND_LABEL[process.kind]} is already ${process.status}`);
}

/** Skips every pending task of a process (completing with what's left, or cancelling). */
async function skipPending(processId: Types.ObjectId, actorId: string | null, reason: string): Promise<void> {
  await LifecycleTaskModel.updateMany(
    { processId, status: 'pending' },
    { $set: { status: 'skipped', skippedBy: actorId ? oid(actorId) : null, skippedAt: new Date(), skipReason: reason } }
  );
}

/**
 * Completes a process once nothing is pending (or `skipRemaining` skips it). Completing
 * offboarding disables the account (O3): refused while they have direct reports, and for
 * the organization's last active ORG_ADMIN, who would lock everyone out.
 */
export async function completeProcess(organizationId: Id, processId: string, actorId: string, skipRemaining: boolean): Promise<ILifecycleProcess> {
  const process = await findProcess(organizationId, processId);
  assertActive(process);
  const pending = await LifecycleTaskModel.countDocuments({ processId: process._id, status: 'pending' });
  if (pending && !skipRemaining) {
    throw new ApiError(400, `${pending} task${pending === 1 ? ' is' : 's are'} still pending. Finish or skip ${pending === 1 ? 'it' : 'them'} first.`, { pending });
  }

  let disable: IUser | null = null;
  if (process.kind === 'offboarding') {
    const employee = await UserModel.findOne({ _id: process.employeeId, organizationId: oid(organizationId), isDeleted: false });
    if (employee?.status === 'active') {
      const reports = await UserModel.countDocuments({ organizationId: oid(organizationId), reportsTo: employee._id, isDeleted: false });
      if (reports) throw new ApiError(400, `Reassign ${employee.name}'s direct reports to another manager first`);
      if (employee.role === 'ORG_ADMIN') {
        const otherAdmins = await UserModel.countDocuments({
          organizationId: oid(organizationId),
          role: 'ORG_ADMIN',
          status: 'active',
          isDeleted: false,
          _id: { $ne: employee._id },
        });
        if (!otherAdmins) throw new ApiError(400, `${employee.name} is your organization's only active admin, so their account can't be disabled`);
      }
      disable = employee;
    }
  }

  if (pending) await skipPending(process._id as Types.ObjectId, actorId, 'Skipped when the process was completed');
  const completed = await LifecycleProcessModel.findOneAndUpdate(
    { _id: process._id, status: 'active' },
    { $set: { status: 'completed', completedBy: oid(actorId), completedAt: new Date(), accountDisabled: Boolean(disable) } },
    { returnDocument: 'after' }
  );
  if (!completed) throw new ApiError(409, `This ${KIND_LABEL[process.kind]} was just completed or cancelled`);
  if (disable) await UserModel.updateOne({ _id: disable._id }, { $set: { status: 'disabled', updatedBy: oid(actorId) } });
  return completed;
}

/** Cancels an active process (a hire who doesn't join, a leaver who stays); its pending tasks are skipped. */
export async function cancelProcess(organizationId: Id, processId: string, actorId: string | null, reason: string): Promise<ILifecycleProcess> {
  const process = await findProcess(organizationId, processId);
  assertActive(process);
  const cancelled = await LifecycleProcessModel.findOneAndUpdate(
    { _id: process._id, status: 'active' },
    { $set: { status: 'cancelled', cancelledBy: actorId ? oid(actorId) : null, cancelledAt: new Date(), cancelledReason: reason } },
    { returnDocument: 'after' }
  );
  if (!cancelled) throw new ApiError(409, `This ${KIND_LABEL[process.kind]} was just completed or cancelled`);
  await skipPending(process._id as Types.ObjectId, actorId, 'Process cancelled');
  return cancelled;
}

/** When someone is removed, their running processes stop. */
export async function cancelProcessesFor(organizationId: Id, employeeId: string, actorId: string, reason: string): Promise<void> {
  const running = await LifecycleProcessModel.find({ organizationId: oid(organizationId), employeeId: oid(employeeId), status: 'active' }, { _id: 1 });
  for (const p of running) await cancelProcess(organizationId, String(p._id), actorId, reason);
}

// ---------------------------------------------------------------- tasks

/**
 * A task the actor may work on: its assignee, or any ORG_ADMIN. Others get 404, so a
 * task's existence isn't revealed.
 */
export async function taskForActor(organizationId: Id, taskId: string, actor: { id: string; role: string }): Promise<ILifecycleTask> {
  const task = Types.ObjectId.isValid(taskId) ? await LifecycleTaskModel.findOne({ _id: taskId, organizationId: oid(organizationId) }) : null;
  if (!task || (actor.role !== 'ORG_ADMIN' && String(task.assigneeId) !== actor.id)) throw new ApiError(404, 'Task not found');
  return task;
}

/** The task's process, which must still be running. */
export async function activeProcessOf(task: ILifecycleTask): Promise<ILifecycleProcess> {
  const process = await LifecycleProcessModel.findById(task.processId);
  if (!process) throw new ApiError(404, 'Process not found');
  assertActive(process);
  return process;
}

export function assertPending(task: ILifecycleTask): void {
  if (task.status !== 'pending') throw new ApiError(409, `This task is already ${task.status === 'done' ? 'done' : 'skipped'}`);
}

/**
 * Marks a task done, with what its type needs: an upload needs a file, a form every
 * answer, an acknowledgement the tick. An atomic update from pending (a stale one: 409).
 */
export async function completeTask(
  task: ILifecycleTask,
  actorId: string,
  input: { note: string; answers?: string[]; acknowledged?: boolean }
): Promise<ILifecycleTask> {
  assertPending(task);
  const set: Record<string, unknown> = { status: 'done', completedBy: oid(actorId), completedAt: new Date(), note: input.note };
  const filter: Record<string, unknown> = { _id: task._id, status: 'pending' };
  if (task.type === 'upload') {
    if (task.files.length === 0) throw new ApiError(400, 'Upload the file first');
    filter['files.0'] = { $exists: true };
  }
  if (task.type === 'acknowledge') {
    if (input.acknowledged !== true) throw fieldError('acknowledged', 'Tick “I’ve read this” first');
    set.acknowledged = true;
  }
  if (task.type === 'form') {
    const answers = input.answers ?? [];
    if (answers.length !== task.questions.length || answers.some((a) => !a.trim())) throw fieldError('answers', 'Answer every question');
    set.answers = task.questions.map((question, i) => ({ question, text: answers[i].trim() }));
  }
  const done = await LifecycleTaskModel.findOneAndUpdate(filter, { $set: set }, { returnDocument: 'after' });
  if (done) return done;
  const current = await LifecycleTaskModel.findById(task._id);
  if (current?.status === 'pending') throw new ApiError(400, 'Upload the file first');
  throw new ApiError(409, `This task is already ${current?.status === 'done' ? 'done' : 'skipped'}`);
}

/** Pending tasks that count as overdue on `today`. */
export function isOverdue(task: Pick<ILifecycleTask, 'status' | 'dueDate'>, today: string): boolean {
  return task.status === 'pending' && task.dueDate < today;
}

// ---------------------------------------------------------------- audit

const KIND = { onboarding: 'Onboarding', offboarding: 'Offboarding' } as const;

export async function employeeName(id: Types.ObjectId): Promise<string> {
  return (await UserModel.findById(id, { name: 1 }))?.name ?? 'a former member';
}

/** "Onboarding started for Ivy Mehta", plus any detail. Reasons, notes and answers never go in the audit log. */
export async function auditProcess(req: Request, action: 'create' | 'update', process: ILifecycleProcess, what: string, detail = ''): Promise<void> {
  await auditCrud(req, action, 'onboarding', {
    id: String(process._id),
    label: `${KIND[process.kind]} ${what} for ${await employeeName(process.employeeId)}${detail}`,
  });
}

/** 'Task "Prepare laptop" skipped (Ivy Mehta's onboarding)'. */
export async function auditTask(req: Request, action: 'create' | 'update', task: ILifecycleTask, what: string): Promise<void> {
  await auditCrud(req, action, 'onboarding', {
    id: String(task._id),
    label: `Task "${task.title}" ${what} (${await employeeName(task.employeeId)}'s ${task.kind})`,
  });
}
