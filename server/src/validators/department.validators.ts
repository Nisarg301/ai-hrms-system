import { z } from 'zod';
import { DEPARTMENT_STATUSES } from '../models/department.model';

export const createDepartmentSchema = z.object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    status: z.enum(DEPARTMENT_STATUSES).default('active'),
});

export const updateDepartmentSchema = z.object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    status: z.enum(DEPARTMENT_STATUSES).optional(),
});
