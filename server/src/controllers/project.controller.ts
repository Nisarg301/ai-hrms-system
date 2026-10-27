import { Request, Response } from 'express';
import { QueryFilter } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { projectRepository } from '../repositories/project.repository';
import { auditCrud } from '../services/audit.service';
import { successResponse, ApiError } from '../utils/apiResponse';
import { parsePaginationQuery } from '../utils/pagination';
import { IProjectRecord } from '../models/project.model';
import { containsPattern } from '../utils/regex';
import { addDays, zonedInstant } from '../utils/dates';
import { listProjectsQuerySchema } from '../validators/project.validators';

function serialize(p: IProjectRecord) {
  return {
    id: p._id.toString(),
    name: p.name,
    description: p.description,
    deadline: p.deadline,
    status: p.status,
  };
}

export const createProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await projectRepository.create(
    {
      organizationId: req.orgFilter!.organizationId,
      name: req.body.name,
      description: req.body.description,
      deadline: req.body.deadline,
      status: req.body.status,
    },
    req.user!.id
  );
  await auditCrud(req, 'create', 'projects', { id: project._id.toString(), label: project.name });
  res.status(201).json(successResponse(serialize(project)));
});

export const listProjects = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip, search, sortBy, sortDir } = parsePaginationQuery(req.query as Record<string, unknown>);
  const filter: QueryFilter<IProjectRecord> = { organizationId: req.orgFilter!.organizationId };
  if (search) {
    filter.name = containsPattern(search);
  }
  // Optional filters (the AI assistant asks for "overdue" or "on hold" projects with these).
  const filters = listProjectsQuerySchema.safeParse(req.query);
  if (!filters.success) {
    throw new ApiError(400, 'Validation failed', filters.error.flatten());
  }
  const { status, dueFrom, dueTo } = filters.data;
  if (status) filter.status = { $in: status };
  if (dueFrom || dueTo) {
    // A deadline is an instant; the range covers whole days in APP_TIMEZONE.
    filter.deadline = {
      ...(dueFrom ? { $gte: zonedInstant(dueFrom, '00:00') } : {}),
      ...(dueTo ? { $lt: zonedInstant(addDays(dueTo, 1), '00:00') } : {}),
    };
  }
  const { items, total } = await projectRepository.paginate({ filter, skip, limit, sortBy, sortDir });
  res.status(200).json(successResponse(items.map(serialize), { page, limit, total }));
});

export const getProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await projectRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
  if (!project) {
    throw new ApiError(404, 'Project not found');
  }
  res.status(200).json(successResponse(serialize(project)));
});

export const updateProject = asyncHandler(async (req: Request, res: Response) => {
  const existing = await projectRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
  if (!existing) {
    throw new ApiError(404, 'Project not found');
  }
  const updated = await projectRepository.updateById(req.params.id, req.body, req.user!.id);
  await auditCrud(req, 'update', 'projects', { id: req.params.id, label: updated!.name });
  res.status(200).json(successResponse(serialize(updated!)));
});

export const deleteProject = asyncHandler(async (req: Request, res: Response) => {
  const existing = await projectRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
  if (!existing) {
    throw new ApiError(404, 'Project not found');
  }
  await projectRepository.softDelete(req.params.id, req.user!.id);
  await auditCrud(req, 'delete', 'projects', { id: req.params.id, label: existing.name });
  res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});
