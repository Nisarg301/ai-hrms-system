import { z } from 'zod';
import { USER_STATUSES } from '../constants/roles';
import { objectIdSchema } from './objectId';
import { dateOfBirthSchema, isoDateSchema } from './date';
import { onboardingOptionsSchema } from './lifecycle.validators';

export const createEmployeeSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().min(1).email(),
  jobTitle: z.string().trim().min(1),
  department: objectIdSchema,
  roleId: z.string().trim().min(1),
  // Optional: the manager can be set later, and the joining date defaults to the creation date.
  reportsTo: objectIdSchema.nullable().optional(),
  joiningDate: isoDateSchema.optional(),
  dateOfBirth: dateOfBirthSchema.optional(),
  // Start onboarding with the new employee (the whole request fails if it can't start).
  onboarding: onboardingOptionsSchema.optional(),
});

/** GET /employees filters, next to page/limit/search/sortBy/sortDir. */
export const listEmployeesQuerySchema = z.object({
  department: objectIdSchema.optional(),
  status: z.enum(USER_STATUSES).optional(),
  /** The employees who have this role (the AI assistant counts them before deleting a role). */
  roleId: objectIdSchema.optional(),
});

export const updateEmployeeSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().min(1).email().optional(),
  jobTitle: z.string().trim().min(1).optional(),
  department: objectIdSchema.optional(),
  roleId: z.string().trim().min(1).optional(),
  status: z.enum(USER_STATUSES).optional(),
  // null clears the manager.
  reportsTo: objectIdSchema.nullable().optional(),
  joiningDate: isoDateSchema.optional(),
  // null clears it.
  dateOfBirth: dateOfBirthSchema.nullable().optional(),
});
