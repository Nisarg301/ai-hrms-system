import { Request, Response } from 'express';
import { QueryFilter, Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { taskRepository } from '../repositories/task.repository';
import { auditCrud } from '../services/audit.service';
import { projectRepository } from '../repositories/project.repository';
import { successResponse, ApiError } from '../utils/apiResponse';
import { parsePaginationQuery } from '../utils/pagination';
import { ITaskRecord } from '../models/task.model';
import { userRepository } from '../repositories/user.repository';
import { containsPattern } from '../utils/regex';
import { listTasksQuerySchema } from '../validators/task.validators';

async function serialize(t: ITaskRecord, projectName?: string) {
  let resolvedProjectName = projectName;
  if (!resolvedProjectName && t.projectId) {
    const project = await projectRepository.findById(t.projectId, { organizationId: t.organizationId });
    resolvedProjectName = project?.name ?? 'Unknown';
  }
  let userName = '';
  if (t.userId && t.userId.length > 0) {
    const users = await userRepository.find({
      organizationId: t.organizationId,
      _id: { $in: t.userId },
    });
    const userNameById = new Map(users.map((u) => [u._id.toString(), u.name]));
    userName = t.userId.map((id) => userNameById.get(id.toString()) ?? 'Unknown').join(', ');
  }
  return {
    id: t._id.toString(),
    projectId: t.projectId ? t.projectId.toString() : '',
    title: t.title,
    description: t.description,
    dueDate: t.dueDate,
    status: t.status,
    projectName: resolvedProjectName ?? 'Unknown',
    userId: t.userId ? t.userId.map((u) => u.toString()) : [],
    userName,
  };
}

async function assertMembersInOrg(userIds: string[], organizationId: Types.ObjectId): Promise<void> {
  const uniqueIds = [...new Set(userIds)];
  const found = await userRepository.count({ organizationId, _id: { $in: uniqueIds } });
  if (found !== uniqueIds.length) {
    throw new ApiError(404, 'One or more members were not found in your organization');
  }
}

export const createTask = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  let projectName: string | undefined;
  if (req.body.projectId) {
    const project = await projectRepository.findById(req.body.projectId, { organizationId });
    if (!project) {
      throw new ApiError(404, 'Project not found');
    }
    projectName = project.name;
  }
  await assertMembersInOrg(req.body.userId, organizationId);
  const task = await taskRepository.create(
    {
      organizationId,
      projectId: req.body.projectId || null,
      title: req.body.title,
      description: req.body.description,
      dueDate: req.body.dueDate,
      status: req.body.status,
      userId: req.body.userId || [],
    },
    req.user!.id
  );
  await auditCrud(req, 'create', 'tasks', { id: task._id.toString(), label: task.title });
  const data = await serialize(task, projectName);
  res.status(201).json(successResponse(data));
});

export const listTasks = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip, search, sortBy, sortDir } = parsePaginationQuery(req.query as Record<string, unknown>);
  const organizationId = req.orgFilter!.organizationId;
  const filter: QueryFilter<ITaskRecord> = { organizationId };
  if (search) {
    filter.title = containsPattern(search);
  }
  // Optional filters (the AI assistant asks for "my open tasks" or "overdue" with these).
  const filters = listTasksQuerySchema.safeParse(req.query);
  if (!filters.success) {
    throw new ApiError(400, 'Validation failed', filters.error.flatten());
  }
  const { projectId, status, dueFrom, dueTo, memberId } = filters.data;
  if (projectId) filter.projectId = new Types.ObjectId(projectId);
  if (status) filter.status = { $in: status };
  if (dueFrom || dueTo) filter.dueDate = { ...(dueFrom ? { $gte: dueFrom } : {}), ...(dueTo ? { $lte: dueTo } : {}) };
  if (memberId) filter.userId = new Types.ObjectId(memberId);
  const { items, total } = await taskRepository.paginate({ filter, skip, limit, sortBy, sortDir });
  const projects = await projectRepository.find({ organizationId });
  const users = await userRepository.find({ organizationId });
  const projectNameById = new Map(projects.map((p) => [p._id.toString(), p.name]));
  const userNameById = new Map(users.map((u) => [u._id.toString(), u.name]));
  const data = items.map((t) => ({
    id: t._id.toString(),
    projectId: t.projectId ? t.projectId.toString() : '',
    title: t.title,
    description: t.description,
    dueDate: t.dueDate,
    status: t.status,
    projectName: t.projectId ? (projectNameById.get(t.projectId.toString()) ?? 'Unknown') : 'Unknown',
    userId: t.userId ? t.userId.map((u) => u.toString()) : [],
    userName:
      t.userId && t.userId.length > 0
        ? t.userId.map((u) => userNameById.get(u.toString()) ?? 'Unknown').join(',')
        : '',
  }));
  res.status(200).json(successResponse(data, { page, limit, total }));
});

export const getTask = asyncHandler(async (req: Request, res: Response) => {
  const task = await taskRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
  if (!task) {
    throw new ApiError(404, 'Task not found');
  }
  const data = await serialize(task);
  res.status(200).json(successResponse(data));
});

export const updateTask = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const existing = await taskRepository.findById(req.params.id, { organizationId });
  if (!existing) {
    throw new ApiError(404, 'Task not found');
  }
  if (req.body.projectId) {
    const project = await projectRepository.findById(req.body.projectId, { organizationId });
    if (!project) {
      throw new ApiError(404, 'Project not found');
    }
  }
  if (req.body.userId) {
    await assertMembersInOrg(req.body.userId, organizationId);
  }
  const updated = await taskRepository.updateById(req.params.id, req.body, req.user!.id);
  await auditCrud(req, 'update', 'tasks', { id: req.params.id, label: updated!.title });
  const data = await serialize(updated!);
  res.status(200).json(successResponse(data));
});

export const deleteTask = asyncHandler(async (req: Request, res: Response) => {
  const existing = await taskRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
  if (!existing) {
    throw new ApiError(404, 'Task not found');
  }
  await taskRepository.softDelete(req.params.id, req.user!.id);
  await auditCrud(req, 'delete', 'tasks', { id: req.params.id, label: existing.title });
  res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});
