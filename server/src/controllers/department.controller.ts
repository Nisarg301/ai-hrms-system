import { Request, Response } from 'express';
import { QueryFilter } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { departmentRepository } from '../repositories/department.repository';
import { auditCrud } from '../services/audit.service';
import { userRepository } from '../repositories/user.repository';
import { successResponse, ApiError } from '../utils/apiResponse';
import { parsePaginationQuery } from '../utils/pagination';
import { IDepartmentRecord } from '../models/department.model';
import { containsPattern } from '../utils/regex';
import { listDepartmentsQuerySchema } from '../validators/department.validators';

function serialize(d: IDepartmentRecord) {
    return {
        id: d._id.toString(),
        title: d.title,
        description: d.description,
        status: d.status,
    };
}

export const createDepartment = asyncHandler(async (req: Request, res: Response) => {
    const department = await departmentRepository.create(
        {
            organizationId: req.orgFilter!.organizationId,
            title: req.body.title,
            description: req.body.description,
            status: req.body.status,
        },
        req.user!.id
    );
    await auditCrud(req, 'create', 'departments', { id: department._id.toString(), label: department.title });
    res.status(201).json(successResponse(serialize(department)));
});

export const listDepartments = asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, skip, search, sortBy, sortDir } = parsePaginationQuery(req.query as Record<string, unknown>);
    const filter: QueryFilter<IDepartmentRecord> = { organizationId: req.orgFilter!.organizationId };
    if (search) {
        filter.$or = [{ title: containsPattern(search) }, { description: containsPattern(search) }];
    }
    // Optional filter (the AI assistant lists "inactive departments" with it).
    const filters = listDepartmentsQuerySchema.safeParse(req.query);
    if (!filters.success) {
        throw new ApiError(400, 'Validation failed', filters.error.flatten());
    }
    if (filters.data.status) filter.status = filters.data.status;
    const { items, total } = await departmentRepository.paginate({ filter, skip, limit, sortBy, sortDir });
    res.status(200).json(successResponse(items.map(serialize), { page, limit, total }));
});

export const getDepartment = asyncHandler(async (req: Request, res: Response) => {
    const department = await departmentRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
    if (!department) {
        throw new ApiError(404, 'Department not found');
    }
    res.status(200).json(successResponse(serialize(department)));
});

export const updateDepartment = asyncHandler(async (req: Request, res: Response) => {
    const existing = await departmentRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
    if (!existing) {
        throw new ApiError(404, 'Department not found');
    }
    const updated = await departmentRepository.updateById(req.params.id, req.body, req.user!.id);
    await auditCrud(req, 'update', 'departments', { id: req.params.id, label: updated!.title });
    res.status(200).json(successResponse(serialize(updated!)));
});

export const deleteDepartment = asyncHandler(async (req: Request, res: Response) => {
    const existing = await departmentRepository.findById(req.params.id, { organizationId: req.orgFilter!.organizationId });
    if (!existing) {
        throw new ApiError(404, 'Department not found');
    }

    const usersInDepartment = await userRepository.count({ organizationId: req.orgFilter!.organizationId, department: req.params.id });
    if (usersInDepartment > 0) {
        throw new ApiError(400, 'Department is assigned to some employees');
    }

    await departmentRepository.softDelete(req.params.id, req.user!.id);
    await auditCrud(req, 'delete', 'departments', { id: req.params.id, label: existing.title });
    res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});
