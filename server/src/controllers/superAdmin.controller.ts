import { Request, Response } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { inviteService } from '../services/invite.service';
import { userRepository } from '../repositories/user.repository';
import { successResponse, ApiError } from '../utils/apiResponse';
import { parsePaginationQuery } from '../utils/pagination';
import { QueryFilter, Types } from 'mongoose';
import { IUser } from '../models/user.model';
import { organizationRepository } from '../repositories/organization.repository';
import { containsPattern } from '../utils/regex';

export const inviteOrgAdmin = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(401, 'Authentication required');
  }
  const { user, tempPassword } = await inviteService.inviteOrgAdmin({
    name: req.body.name,
    email: req.body.email,
    organizationId: req.body.organizationId,
    organizationName: req.body.organizationName,
    invitedBy: req.user.id,
  });
  res.status(201).json(
    successResponse({
      user: { id: user._id.toString(), name: user.name, email: user.email, organizationId: user.organizationId?.toString() ?? null },
      temp_password: tempPassword,
    })
  );
});

export const listAdminUsers = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip, search, sortBy, sortDir } = parsePaginationQuery(req.query as Record<string, unknown>);
  const filter: QueryFilter<IUser> = { role: 'ORG_ADMIN' };
  if (search) {
    filter.$or = [{ name: containsPattern(search) }, { email: containsPattern(search) }];
  }
  const { items, total } = await userRepository.paginate({ filter, skip, limit, sortBy, sortDir });

  const orgIds = items
    .map((u) => u.organizationId)
    .filter((id): id is Types.ObjectId => id !== null && id !== undefined);
  const orgs = orgIds.length > 0 ? await organizationRepository.find({ _id: { $in: orgIds } }) : [];
  const orgNameById = new Map(orgs.map((o) => [o._id.toString(), o.name]));

  res.status(200).json(
    successResponse(
      items.map((u) => {
        const organizationId = u.organizationId ? u.organizationId.toString() : null;
        return {
          id: u._id.toString(),
          name: u.name,
          email: u.email,
          organizationId,
          organizationName: organizationId ? orgNameById.get(organizationId) ?? null : null,
          status: u.status,
          createdAt: u.createdAt,
        };
      }),
      { page, limit, total }
    )
  );
});

export const disableAdminUser = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(401, 'Authentication required');
  }
  const updated = await userRepository.updateById(req.params.id, { status: 'disabled' }, req.user.id);
  if (!updated) {
    throw new ApiError(404, 'Admin user not found');
  }
  res.status(200).json(successResponse({ id: updated._id.toString(), status: updated.status }));
});
