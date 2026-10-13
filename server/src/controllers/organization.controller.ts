import { Request, Response } from 'express';
import { QueryFilter } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { organizationRepository } from '../repositories/organization.repository';
import { successResponse } from '../utils/apiResponse';
import { parsePaginationQuery } from '../utils/pagination';
import { IOrganization } from '../models/organization.model';
import { containsPattern } from '../utils/regex';

export const listOrganizations = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip, search, sortBy, sortDir } = parsePaginationQuery(req.query as Record<string, unknown>);
  const filter: QueryFilter<IOrganization> = {};
  if (search) {
    filter.name = containsPattern(search);
  }
  const { items, total } = await organizationRepository.paginate({ filter, skip, limit, sortBy, sortDir });
  res.status(200).json(
    successResponse(
      items.map((o) => ({
        id: o._id.toString(),
        name: o.name,
        isActive: o.isActive,
        createdAt: o.createdAt,
      })),
      { page, limit, total }
    )
  );
});
