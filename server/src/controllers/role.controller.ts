import { Request, Response } from 'express';
import { QueryFilter } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { roleRepository } from '../repositories/role.repository';
import { auditCrud } from '../services/audit.service';
import { userRepository } from '../repositories/user.repository';
import { successResponse, ApiError } from '../utils/apiResponse';
import { parsePaginationQuery } from '../utils/pagination';
import { IRole, IRolePermission } from '../models/role.model';
import { SubscriptionState } from '../services/subscription.service';
import { containsPattern } from '../utils/regex';

/** A role may only grant modules the organization's plan includes. */
function assertModulesInPlan(permissions: IRolePermission[] | undefined, subscription: SubscriptionState): void {
  const outside = (permissions ?? []).filter((p) => !subscription.modules.includes(p.module)).map((p) => p.module);
  if (outside.length > 0) {
    throw new ApiError(400, 'Validation failed', {
      fieldErrors: { permissions: [`Not included in your plan: ${outside.join(', ')}`] },
    });
  }
}

export const createRole = asyncHandler(async (req: Request, res: Response) => {
  assertModulesInPlan(req.body.permissions, req.subscription!);
  const role = await roleRepository.create(
    { organizationId: req.orgFilter!.organizationId, name: req.body.name, permissions: req.body.permissions },
    req.user!.id
  );
  await auditCrud(req, 'create', 'roles', { id: role._id.toString(), label: role.name });
  res.status(201).json(successResponse({ id: role._id.toString(), name: role.name, permissions: role.permissions }));
});

export const listRoles = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip, search, sortBy, sortDir } = parsePaginationQuery(req.query as Record<string, unknown>);
  const filter: QueryFilter<IRole> = { organizationId: req.orgFilter!.organizationId };
  if (search) {
    filter.name = containsPattern(search);
  }
  const { items, total } = await roleRepository.paginate({ filter, skip, limit, sortBy, sortDir });
  res.status(200).json(
    successResponse(
      items.map((r) => ({ id: r._id.toString(), name: r.name, permissions: r.permissions })),
      { page, limit, total }
    )
  );
});

export const getRole = asyncHandler(async (req: Request, res: Response) => {
  const role = await roleRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
  if (!role) {
    throw new ApiError(404, 'Role not found');
  }
  res.status(200).json(successResponse({ id: role._id.toString(), name: role.name, permissions: role.permissions }));
});

export const updateRole = asyncHandler(async (req: Request, res: Response) => {
  const existing = await roleRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
  if (!existing) {
    throw new ApiError(404, 'Role not found');
  }
  const body = { ...req.body };
  if (body.permissions) {
    assertModulesInPlan(body.permissions, req.subscription!);
    // Keep rows for modules the current plan hides (e.g. Exports after a downgrade to
    // Basic): the editor never sees them, so it must not be able to erase them.
    const hidden = existing.permissions
      .filter((p) => !req.subscription!.modules.includes(p.module))
      .map((p) => ({ module: p.module, read: p.read, create: p.create, update: p.update, delete: p.delete }));
    body.permissions = [...body.permissions, ...hidden];
  }
  const updated = await roleRepository.updateById(req.params.id, body, req.user!.id);
  await auditCrud(req, 'update', 'roles', { id: req.params.id, label: updated!.name });
  res.status(200).json(successResponse({ id: updated?._id.toString(), name: updated?.name, permissions: updated?.permissions }));
});

export const deleteRole = asyncHandler(async (req: Request, res: Response) => {
  const existing = await roleRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
  if (!existing) {
    throw new ApiError(404, 'Role not found');
  }

  const usersWithRole = await userRepository.count({ organizationId: req.orgFilter!.organizationId, roleId: req.params.id })
  if (usersWithRole > 0) {
    throw new ApiError(400, 'Role is assigned to some users');
  }

  await roleRepository.softDelete(req.params.id, req.user!.id);
  await auditCrud(req, 'delete', 'roles', { id: req.params.id, label: existing.name });
  res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});
