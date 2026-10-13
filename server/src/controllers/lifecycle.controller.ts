import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { ILifecycleProcess, LifecycleProcessModel } from '../models/lifecycleProcess.model';
import { ILifecycleTask, LifecycleTaskModel } from '../models/lifecycleTask.model';
import { UserModel } from '../models/user.model';
import { deleteFile, downloadFile, uploadFile } from '../services/gridfs.service';
import { announceAssigned, announceReadyIfDone, announceStart, resetReady } from '../services/lifecycleNotify.service';
import { formatDates } from '../services/notification.service';
import {
  MAX_NOTICE_DAYS,
  MAX_TASK_FILES,
  activeMember,
  activeProcessOf,
  assertActive,
  assertCanOnboard,
  candidatesFor,
  assertPending,
  cancelProcess,
  checkBuddy,
  completeProcess,
  completeTask,
  fieldError,
  findProcess,
  isOverdue,
  auditProcess,
  auditTask,
  employeeName,
  startProcess,
  taskForActor,
  templateFor,
} from '../services/lifecycle.service';
import { Person, departmentNameMap, effectiveJoiningDate, toPerson } from '../services/people.service';
import { successResponse, ApiError } from '../utils/apiResponse';
import { addDays, todayIso } from '../utils/dates';
import { parsePaginationQuery } from '../utils/pagination';
import { candidatesQuerySchema, processListQuerySchema } from '../validators/lifecycle.validators';

type People = Map<string, Person>;

/** Colleague summaries by id (removed people too, so old tasks still read right). */
async function peopleFor(organizationId: Types.ObjectId, ids: (Types.ObjectId | null | undefined)[]): Promise<People> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const [users, departments] = await Promise.all([UserModel.find({ _id: { $in: unique }, organizationId }), departmentNameMap(organizationId)]);
  return new Map(users.map((u) => [String(u._id), toPerson(u, departments)]));
}

const nameOf = (people: People, id: Types.ObjectId | null) => (id ? (people.get(String(id))?.name ?? 'Former member') : null);

/** A task as its assignee or an ORG_ADMIN sees it; form answers are ORG_ADMIN-only (an exit interview). */
function taskView(t: ILifecycleTask, people: People, isAdmin: boolean, today: string) {
  return {
    id: String(t._id),
    processId: String(t.processId),
    employeeId: String(t.employeeId),
    kind: t.kind,
    order: t.order,
    title: t.title,
    instructions: t.instructions,
    type: t.type,
    questions: t.questions,
    link: t.link,
    assigneeKind: t.assigneeKind,
    assigneeId: t.assigneeId ? String(t.assigneeId) : null,
    assigneeName: nameOf(people, t.assigneeId),
    dueDate: t.dueDate,
    overdue: isOverdue(t, today),
    status: t.status,
    completedByName: nameOf(people, t.completedBy),
    completedAt: t.completedAt,
    note: t.note,
    files: t.files.map((f) => ({ id: String(f.fileId), originalName: f.originalName, mimeType: f.mimeType, size: f.size })),
    answers: isAdmin ? t.answers.map((a) => ({ question: a.question, text: a.text })) : null,
    acknowledged: t.acknowledged,
    skipReason: t.skipReason,
    adHoc: t.adHoc,
  };
}

interface Progress {
  total: number;
  done: number;
  skipped: number;
  pending: number;
  overdue: number;
}

function progressOf(tasks: Pick<ILifecycleTask, 'status' | 'dueDate'>[], today: string): Progress {
  return {
    total: tasks.length,
    done: tasks.filter((t) => t.status === 'done').length,
    skipped: tasks.filter((t) => t.status === 'skipped').length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    overdue: tasks.filter((t) => isOverdue(t, today)).length,
  };
}

/**
 * A process. The reason, admin notes and why it was cancelled are ORG_ADMIN-only.
 * The manager is the person's current one.
 */
function processView(p: ILifecycleProcess, people: People, isAdmin: boolean, progress: Progress) {
  const employee = people.get(String(p.employeeId)) ?? null;
  return {
    id: String(p._id),
    kind: p.kind,
    status: p.status,
    templateName: p.templateName,
    anchorDate: p.anchorDate,
    employee,
    manager: employee?.reportsTo ? (people.get(employee.reportsTo) ?? null) : null,
    buddy: p.buddyId ? (people.get(String(p.buddyId)) ?? null) : null,
    reason: isAdmin ? p.reason : null,
    adminNotes: isAdmin ? p.adminNotes : null,
    progress,
    startedAt: p.createdAt,
    startedByName: nameOf(people, p.startedBy),
    completedAt: p.completedAt,
    completedByName: nameOf(people, p.completedBy),
    accountDisabled: p.accountDisabled,
    cancelledAt: p.cancelledAt,
    cancelledReason: isAdmin ? p.cancelledReason : null,
  };
}

/** Everyone a set of processes and tasks mentions, including each employee's manager. */
async function peopleOf(organizationId: Types.ObjectId, processes: ILifecycleProcess[], tasks: ILifecycleTask[]): Promise<People> {
  const direct = await peopleFor(organizationId, [
    ...processes.flatMap((p) => [p.employeeId, p.buddyId, p.startedBy, p.completedBy]),
    ...tasks.flatMap((t) => [t.assigneeId, t.completedBy]),
  ]);
  const managers = [...direct.values()].map((p) => p.reportsTo).filter((id): id is string => Boolean(id) && !direct.has(id!));
  if (!managers.length) return direct;
  const more = await peopleFor(organizationId, managers.map((id) => new Types.ObjectId(id)));
  return new Map([...direct, ...more]);
}

/** The full process with every task (ORG_ADMIN). */
async function processDetail(organizationId: Types.ObjectId, process: ILifecycleProcess) {
  const today = todayIso();
  const tasks = await LifecycleTaskModel.find({ processId: process._id }).sort({ order: 1, _id: 1 });
  const people = await peopleOf(organizationId, [process], tasks);
  return { ...processView(process, people, true, progressOf(tasks, today)), tasks: tasks.map((t) => taskView(t, people, true, today)) };
}

// ---------------------------------------------------------------- starting

export const startOnboarding = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const employee = await activeMember(organizationId, req.body.employeeId);
  if (!employee) throw new ApiError(404, 'Employee not found');
  await assertCanOnboard(organizationId, employee, req.user!.id, todayIso());
  const template = await templateFor(organizationId, req.body.templateId, 'onboarding');
  const buddy = await checkBuddy(organizationId, req.body.buddyId, String(employee._id));
  const process = await startProcess({
    organizationId,
    employee,
    kind: 'onboarding',
    template,
    anchorDate: effectiveJoiningDate(employee),
    buddy,
    startedBy: req.user!.id,
  });
  await auditProcess(req, 'create', process, 'started');
  await announceStart(process, req.user!.id);
  res.status(201).json(successResponse(await processDetail(organizationId, process)));
});

export const startOffboarding = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  if (req.body.employeeId === req.user!.id) throw new ApiError(400, 'You can’t offboard yourself. Ask another admin.');
  const employee = await activeMember(organizationId, req.body.employeeId);
  if (!employee) throw new ApiError(404, 'Employee not found');
  const today = todayIso();
  if (req.body.lastWorkingDay < today) throw fieldError('lastWorkingDay', 'The last working day can’t be in the past');
  if (req.body.lastWorkingDay > addDays(today, MAX_NOTICE_DAYS)) throw fieldError('lastWorkingDay', `At most ${MAX_NOTICE_DAYS} days ahead`);
  const template = await templateFor(organizationId, req.body.templateId, 'offboarding');
  const process = await startProcess({
    organizationId,
    employee,
    kind: 'offboarding',
    template,
    anchorDate: req.body.lastWorkingDay,
    buddy: null,
    reason: req.body.reason,
    adminNotes: req.body.adminNotes,
    startedBy: req.user!.id,
  });
  await auditProcess(req, 'create', process, 'started', ` (last day ${formatDates(process.anchorDate)})`);
  await announceStart(process, req.user!.id);
  res.status(201).json(successResponse(await processDetail(organizationId, process)));
});

/** Who a process can be started for (the admin's picker): new joiners, or anyone not leaving. */
export const candidates = asyncHandler(async (req: Request, res: Response) => {
  const parsed = candidatesQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  const organizationId = req.orgFilter!.organizationId;
  const [people, departments] = await Promise.all([
    candidatesFor(organizationId, parsed.data.kind, req.user!.id, todayIso()),
    departmentNameMap(organizationId),
  ]);
  res.status(200).json(successResponse(people.map((p) => toPerson(p, departments))));
});

// ---------------------------------------------------------------- admin: processes

/** Paged; running ones by anchor date (soonest first), finished ones newest first. */
export const listProcesses = asyncHandler(async (req: Request, res: Response) => {
  const parsed = processListQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  const organizationId = req.orgFilter!.organizationId;
  const { page, limit, skip } = parsePaginationQuery(req.query as Record<string, unknown>);
  const { kind, status } = parsed.data;
  const filter = { organizationId, ...(kind ? { kind } : {}), ...(status ? { status } : {}) };
  const sort: Record<string, 1 | -1> = status === 'active' ? { anchorDate: 1, _id: 1 } : { updatedAt: -1, _id: -1 };
  const [processes, total] = await Promise.all([
    LifecycleProcessModel.find(filter).sort(sort).skip(skip).limit(limit),
    LifecycleProcessModel.countDocuments(filter),
  ]);
  const today = todayIso();
  const tasks = await LifecycleTaskModel.find({ processId: { $in: processes.map((p) => p._id) } }, { processId: 1, status: 1, dueDate: 1 });
  const people = await peopleOf(organizationId, processes, []);
  res.status(200).json(
    successResponse(
      processes.map((p) => processView(p, people, true, progressOf(tasks.filter((t) => String(t.processId) === String(p._id)), today))),
      { page, limit, total }
    )
  );
});

export const getProcess = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  res.status(200).json(successResponse(await processDetail(organizationId, await findProcess(organizationId, req.params.id))));
});

export const complete = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const process = await completeProcess(organizationId, req.params.id, req.user!.id, req.body.skipRemaining);
  await auditProcess(req, 'update', process, 'completed', process.accountDisabled ? '; account disabled' : '');
  res.status(200).json(successResponse(await processDetail(organizationId, process)));
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const process = await cancelProcess(organizationId, req.params.id, req.user!.id, req.body.reason);
  await auditProcess(req, 'update', process, 'cancelled');
  res.status(200).json(successResponse(await processDetail(organizationId, process)));
});

/** A one-off task for a person, or for the admins (null). */
export const addTask = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const process = await findProcess(organizationId, req.params.id);
  assertActive(process);
  if (req.body.assigneeId && !(await activeMember(organizationId, req.body.assigneeId))) {
    throw fieldError('assigneeId', 'Choose an active member of your organization');
  }
  const last = await LifecycleTaskModel.findOne({ processId: process._id }).sort({ order: -1 });
  const task = await LifecycleTaskModel.create({
    organizationId,
    processId: process._id,
    employeeId: process.employeeId,
    kind: process.kind,
    order: (last?.order ?? -1) + 1,
    title: req.body.title,
    instructions: req.body.instructions,
    type: req.body.type,
    questions: req.body.questions,
    link: req.body.link,
    assigneeKind: req.body.assigneeId ? 'person' : 'admin',
    assigneeId: req.body.assigneeId ?? null,
    dueDate: req.body.dueDate,
    adHoc: true,
  });
  await resetReady(process._id as Types.ObjectId);
  await auditTask(req, 'create', task, 'added');
  await announceAssigned(task, req.user!.id);
  res.status(201).json(successResponse(await processDetail(organizationId, process)));
});

// ---------------------------------------------------------------- admin: tasks

/** Reassign (a person, or null for the admins) and/or move the due date, while pending. */
export const updateTask = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const task = await taskForActor(organizationId, req.params.taskId, req.user!);
  const process = await activeProcessOf(task);
  assertPending(task);
  const set: Record<string, unknown> = {};
  if (req.body.assigneeId !== undefined) {
    if (req.body.assigneeId && !(await activeMember(organizationId, req.body.assigneeId))) {
      throw fieldError('assigneeId', 'Choose an active member of your organization');
    }
    set.assigneeId = req.body.assigneeId;
    set.assigneeKind = req.body.assigneeId ? 'person' : 'admin';
  }
  if (req.body.dueDate !== undefined) set.dueDate = req.body.dueDate;
  const updated = await LifecycleTaskModel.findOneAndUpdate({ _id: task._id, status: 'pending' }, { $set: set }, { returnDocument: 'after' });
  if (!updated) assertPending((await LifecycleTaskModel.findById(task._id))!);
  const reassigned = req.body.assigneeId !== undefined && String(req.body.assigneeId) !== String(task.assigneeId);
  const changes = [
    ...(reassigned ? [`reassigned to ${req.body.assigneeId ? await employeeName(new Types.ObjectId(req.body.assigneeId)) : 'the admins'}`] : []),
    ...(req.body.dueDate !== undefined && req.body.dueDate !== task.dueDate ? [`moved to ${formatDates(req.body.dueDate)}`] : []),
  ];
  if (changes.length) await auditTask(req, 'update', updated!, changes.join(' and '));
  if (reassigned) await announceAssigned(updated!, req.user!.id);
  res.status(200).json(successResponse(await processDetail(organizationId, process)));
});

export const skipTask = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const task = await taskForActor(organizationId, req.params.taskId, req.user!);
  const process = await activeProcessOf(task);
  assertPending(task);
  const skipped = await LifecycleTaskModel.findOneAndUpdate(
    { _id: task._id, status: 'pending' },
    { $set: { status: 'skipped', skippedBy: req.user!.id, skippedAt: new Date(), skipReason: req.body.reason } },
    { returnDocument: 'after' }
  );
  if (!skipped) assertPending((await LifecycleTaskModel.findById(task._id))!);
  await auditTask(req, 'update', skipped!, 'skipped');
  await announceReadyIfDone(process._id as Types.ObjectId, req.user!.id);
  res.status(200).json(successResponse(await processDetail(organizationId, process)));
});

// ---------------------------------------------------------------- my side

/**
 * My running onboarding/offboarding: overall progress, my manager and buddy, and only
 * the tasks that are mine to do. No reason, notes or others' tasks.
 */
export const mine = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const me = new Types.ObjectId(req.user!.id);
  const processes = await LifecycleProcessModel.find({ organizationId, employeeId: me, status: 'active' }).sort({ kind: 1 });
  const today = todayIso();
  const all = await LifecycleTaskModel.find({ processId: { $in: processes.map((p) => p._id) } }).sort({ order: 1, _id: 1 });
  const mineOnly = all.filter((t) => String(t.assigneeId) === req.user!.id);
  const people = await peopleOf(organizationId, processes, mineOnly);
  res.status(200).json(
    successResponse(
      processes.map((p) => {
        const tasks = all.filter((t) => String(t.processId) === String(p._id));
        const { reason: _reason, adminNotes: _notes, cancelledReason: _why, startedByName: _by, ...view } = processView(p, people, false, progressOf(tasks, today));
        return { ...view, tasks: mineOnly.filter((t) => String(t.processId) === String(p._id)).map((t) => taskView(t, people, false, today)) };
      })
    )
  );
});

/**
 * Pending tasks I'm to do in other people's processes (an ORG_ADMIN also gets the
 * admins' ones), grouped by person, soonest due first.
 */
export const assignedToMe = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const me = new Types.ObjectId(req.user!.id);
  const isAdmin = req.user!.role === 'ORG_ADMIN';
  const tasks = await LifecycleTaskModel.find({
    organizationId,
    status: 'pending',
    employeeId: { $ne: me },
    $or: [{ assigneeId: me }, ...(isAdmin ? [{ assigneeId: null }] : [])],
  }).sort({ dueDate: 1, order: 1 });
  const processes = await LifecycleProcessModel.find({ _id: { $in: [...new Set(tasks.map((t) => String(t.processId)))] }, status: 'active' });
  const today = todayIso();
  const people = await peopleOf(organizationId, processes, tasks);
  const groups = processes
    .map((p) => {
      const own = tasks.filter((t) => String(t.processId) === String(p._id));
      return {
        processId: String(p._id),
        kind: p.kind,
        anchorDate: p.anchorDate,
        employee: people.get(String(p.employeeId)) ?? null,
        tasks: own.map((t) => taskView(t, people, isAdmin, today)),
      };
    })
    .filter((g) => g.tasks.length)
    .sort((a, b) => a.tasks[0].dueDate.localeCompare(b.tasks[0].dueDate) || a.anchorDate.localeCompare(b.anchorDate));
  res.status(200).json(successResponse(groups));
});

export const completeMyTask = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const task = await taskForActor(organizationId, req.params.taskId, req.user!);
  await activeProcessOf(task);
  const done = await completeTask(task, req.user!.id, req.body);
  await announceReadyIfDone(done.processId, req.user!.id);
  const people = await peopleFor(organizationId, [done.assigneeId, done.completedBy]);
  res.status(200).json(successResponse(taskView(done, people, req.user!.role === 'ORG_ADMIN', todayIso())));
});

// ---------------------------------------------------------------- task files

async function fileTask(req: Request) {
  const task = await taskForActor(req.orgFilter!.organizationId, req.params.taskId, req.user!);
  await activeProcessOf(task);
  assertPending(task);
  return task;
}

async function taskReply(req: Request, res: Response, taskId: Types.ObjectId, status = 200) {
  const task = (await LifecycleTaskModel.findById(taskId))!;
  const people = await peopleFor(req.orgFilter!.organizationId, [task.assigneeId, task.completedBy]);
  res.status(status).json(successResponse(taskView(task, people, req.user!.role === 'ORG_ADMIN', todayIso())));
}

/** Upload tasks only, while pending, at most MAX_TASK_FILES. */
export const addFile = asyncHandler(async (req: Request, res: Response) => {
  const task = await fileTask(req);
  if (task.type !== 'upload') throw new ApiError(400, 'This task doesn’t take files');
  const file = req.file;
  if (!file) throw new ApiError(400, 'Attach a file');
  if (task.files.length >= MAX_TASK_FILES) throw new ApiError(400, `At most ${MAX_TASK_FILES} files per task`);
  const fileId = await uploadFile({ buffer: file.buffer, filename: file.originalname, contentType: file.mimetype });
  const entry = { fileId, originalName: file.originalname, mimeType: file.mimetype, size: file.size };
  const updated = await LifecycleTaskModel.findOneAndUpdate(
    { _id: task._id, status: 'pending', [`files.${MAX_TASK_FILES - 1}`]: { $exists: false } },
    { $push: { files: entry } },
    { returnDocument: 'after' }
  );
  if (!updated) {
    await deleteFile(fileId).catch(() => undefined);
    const current = await LifecycleTaskModel.findById(task._id);
    if (current) assertPending(current);
    throw new ApiError(400, `At most ${MAX_TASK_FILES} files per task`);
  }
  await taskReply(req, res, task._id as Types.ObjectId, 201);
});

/** For the task's assignee and ORG_ADMINs only; shown inline so images and PDFs preview. */
export const getFile = asyncHandler(async (req: Request, res: Response) => {
  const task = await taskForActor(req.orgFilter!.organizationId, req.params.taskId, req.user!);
  const file = task.files.find((f) => String(f.fileId) === req.params.fileId);
  if (!file) throw new ApiError(404, 'File not found');
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`);
  const stream = downloadFile(file.fileId);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ success: false, error: { message: 'The file is missing' } });
  });
  stream.pipe(res);
});

export const deleteTaskFile = asyncHandler(async (req: Request, res: Response) => {
  const task = await fileTask(req);
  const file = task.files.find((f) => String(f.fileId) === req.params.fileId);
  if (!file) throw new ApiError(404, 'File not found');
  await LifecycleTaskModel.updateOne({ _id: task._id, status: 'pending' }, { $pull: { files: { fileId: file.fileId } } });
  await deleteFile(file.fileId).catch(() => undefined);
  await taskReply(req, res, task._id as Types.ObjectId);
});
