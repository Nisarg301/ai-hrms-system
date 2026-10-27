import { Request, Response } from 'express';
import { QueryFilter, Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { userRepository } from '../repositories/user.repository';
import { auditCrud } from '../services/audit.service';
import { roleRepository } from '../repositories/role.repository';
import { departmentRepository } from '../repositories/department.repository';
import { inviteService } from '../services/invite.service';
import { successResponse, ApiError } from '../utils/apiResponse';
import { parsePaginationQuery } from '../utils/pagination';
import { IUser, UserModel } from '../models/user.model';
import { ILifecycleProcess, LifecycleProcessModel } from '../models/lifecycleProcess.model';
import { LifecycleKind } from '../models/checklistTemplate.model';
import { auditProcess, cancelProcessesFor, checkBuddy, isRecentJoiningDate, ONBOARDING_WINDOW_DAYS, startProcess, templateFor } from '../services/lifecycle.service';
import { announceStart } from '../services/lifecycleNotify.service';
import { assertValidManager, effectiveJoiningDate } from '../services/people.service';
import { containsPattern } from '../utils/regex';
import { todayIso } from '../utils/dates';
import { listEmployeesQuerySchema } from '../validators/employee.validators';

/**
 * `canSeeBirthYear`: only an ORG_ADMIN (who maintains the record) gets the full date
 * of birth. An ORG_USER allowed to read employees gets none: colleagues only ever
 * see a birthday's day and month (in Celebrations and profiles).
 */
type LifecycleTag = { kind: LifecycleKind; anchorDate: string } | null;

function serialize(
  u: IUser,
  roleName: string | null,
  departmentName: string | null,
  reportsToName: string | null,
  canSeeBirthYear = true,
  lifecycle: LifecycleTag = null
) {
  return {
    id: u._id.toString(),
    name: u.name,
    email: u.email,
    jobTitle: u.jobTitle,
    department: u.department?.toString() ?? null,
    departmentName,
    roleId: u.roleId?.toString() ?? null,
    roleName,
    status: u.status,
    reportsTo: u.reportsTo?.toString() ?? null,
    reportsToName,
    joiningDate: effectiveJoiningDate(u),
    dateOfBirth: canSeeBirthYear ? (u.dateOfBirth ?? null) : null,
    /** A running onboarding or offboarding, for the "Onboarding" / "Leaving on …" tag. */
    lifecycle,
  };
}

/**
 * Each person's running process; someone leaving shows as leaving even mid-onboarding.
 * ORG_ADMIN only: a planned departure (a termination, say) mustn't reach colleagues early.
 */
async function lifecycleTags(req: Request, userIds: Types.ObjectId[]): Promise<Map<string, LifecycleTag>> {
  if (req.user!.role !== 'ORG_ADMIN') return new Map();
  const organizationId = req.orgFilter!.organizationId;
  const running = await LifecycleProcessModel.find({ organizationId, employeeId: { $in: userIds }, status: 'active' }, { employeeId: 1, kind: 1, anchorDate: 1 });
  const tags = new Map<string, LifecycleTag>();
  for (const p of running) {
    const key = String(p.employeeId);
    if (!tags.has(key) || p.kind === 'offboarding') tags.set(key, { kind: p.kind, anchorDate: p.anchorDate });
  }
  return tags;
}

async function resolveManagerName(u: IUser): Promise<string | null> {
  if (!u.reportsTo) return null;
  const manager = await userRepository.findById(u.reportsTo, { organizationId: u.organizationId });
  return manager?.name ?? null;
}

async function resolveRoleName(u: IUser): Promise<string | null> {
  if (!u.roleId) return null;
  const role = await roleRepository.findById(u.roleId);
  return role?.name ?? null;
}

async function resolveDepartmentName(u: IUser): Promise<string | null> {
  if (!u.department) return null;
  const department = await departmentRepository.findById(u.department.toString(), { organizationId: u.organizationId });
  return department?.title ?? null;
}

async function assertDepartmentInOrg(departmentId: string, organizationId: Types.ObjectId): Promise<void> {
  const department = await departmentRepository.findById(departmentId, { organizationId });
  if (!department) {
    throw new ApiError(404, 'Department not found in your organization');
  }
}

function emailTakenError(): ApiError {
  return new ApiError(400, 'Validation failed', {
    fieldErrors: { email: ['A user with this email already exists'] },
  });
}

export const createEmployee = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  await assertDepartmentInOrg(req.body.department, organizationId);
  if (req.body.reportsTo) {
    await assertValidManager(req.body.reportsTo, null, organizationId);
  }
  // Onboarding is checked before anyone is created: creating the account emails the temporary password.
  if (req.body.onboarding && req.subscription && !req.subscription.features.includes('onboarding')) {
    throw new ApiError(403, 'This feature is not included in your plan', { code: 'FEATURE_NOT_IN_PLAN', feature: 'onboarding' });
  }
  if (req.body.onboarding && !isRecentJoiningDate(req.body.joiningDate ?? todayIso(), todayIso())) {
    throw new ApiError(400, 'Validation failed', {
      fieldErrors: {
        joiningDate: [`Onboarding is for new joiners: this date is more than ${ONBOARDING_WINDOW_DAYS} days ago. Turn onboarding off, or change the date.`],
      },
    });
  }
  const onboarding = req.body.onboarding
    ? {
        template: await templateFor(organizationId, req.body.onboarding.templateId, 'onboarding'),
        buddy: await checkBuddy(organizationId, req.body.onboarding.buddyId, null),
      }
    : null;
  const { user, tempPassword } = await inviteService
    .inviteOrgUser({
      name: req.body.name,
      email: req.body.email,
      roleId: req.body.roleId,
      organizationId: organizationId.toString(),
      jobTitle: req.body.jobTitle,
      departmentId: req.body.department,
      reportsTo: req.body.reportsTo ?? null,
      joiningDate: req.body.joiningDate,
      dateOfBirth: req.body.dateOfBirth,
      invitedBy: req.user!.id,
    })
    .catch((err: unknown) => {
      if (err instanceof ApiError && err.statusCode === 409) throw emailTakenError();
      if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) throw emailTakenError();
      throw err;
    });
  let lifecycle: LifecycleTag = null;
  let onboardingStarted: ILifecycleProcess | null = null;
  if (onboarding) {
    try {
      const process = await startProcess({
        organizationId,
        employee: user,
        kind: 'onboarding',
        template: onboarding.template,
        anchorDate: effectiveJoiningDate(user),
        buddy: onboarding.buddy,
        startedBy: req.user!.id,
      });
      lifecycle = { kind: 'onboarding', anchorDate: process.anchorDate };
      onboardingStarted = process;
    } catch (err) {
      // All or nothing: without transactions, the new account is removed again.
      await UserModel.deleteOne({ _id: user._id });
      throw err;
    }
  }
  const roleName = await resolveRoleName(user);
  const departmentName = await resolveDepartmentName(user);
  await auditCrud(req, 'create', 'employees', { id: user._id.toString(), label: user.name });
  if (onboardingStarted) {
    await auditProcess(req, 'create', onboardingStarted, 'started');
    await announceStart(onboardingStarted, req.user!.id);
  }
  const reportsToName = await resolveManagerName(user);
  res.status(201).json(successResponse({ user: serialize(user, roleName, departmentName, reportsToName, true, lifecycle), temp_password: tempPassword }));
});

export const listEmployees = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip, search, sortBy, sortDir } = parsePaginationQuery(req.query as Record<string, unknown>);
  const organizationId = req.orgFilter!.organizationId;
  const filter: QueryFilter<IUser> = { organizationId, role: 'ORG_USER' };
  if (search) {
    filter.$or = [{ name: containsPattern(search) }, { email: containsPattern(search) }];
  }
  // Optional filters (the AI assistant counts "employees in Engineering" with these).
  const filters = listEmployeesQuerySchema.safeParse(req.query);
  if (!filters.success) {
    throw new ApiError(400, 'Validation failed', filters.error.flatten());
  }
  if (filters.data.department) filter.department = new Types.ObjectId(filters.data.department);
  if (filters.data.status) filter.status = filters.data.status;
  if (filters.data.roleId) filter.roleId = new Types.ObjectId(filters.data.roleId);
  const { items, total } = await userRepository.paginate({ filter, skip, limit, sortBy, sortDir });
  const roles = await roleRepository.find({ organizationId });
  const roleNameById = new Map(roles.map((r) => [r._id.toString(), r.name]));
  const departments = await departmentRepository.find({ organizationId });
  const departmentNameById = new Map(departments.map((d) => [d._id.toString(), d.title]));
  // Managers can be ORG_ADMINs, who aren't in this ORG_USER-only page, so look them up separately.
  const managerIds = [...new Set(items.map((u) => u.reportsTo?.toString()).filter((id): id is string => Boolean(id)))];
  const managers = managerIds.length ? await userRepository.find({ organizationId, _id: { $in: managerIds } }) : [];
  const managerNameById = new Map(managers.map((m) => [m._id.toString(), m.name]));
  const tags = await lifecycleTags(req, items.map((u) => u._id as Types.ObjectId));
  const data = items.map((u) =>
    serialize(
      u,
      u.roleId ? (roleNameById.get(u.roleId.toString()) ?? null) : null,
      u.department ? (departmentNameById.get(u.department.toString()) ?? null) : null,
      u.reportsTo ? (managerNameById.get(u.reportsTo.toString()) ?? null) : null,
      req.user!.role === 'ORG_ADMIN',
      tags.get(u._id.toString()) ?? null
    )
  );
  res.status(200).json(successResponse(data, { page, limit, total }));
});

export const getEmployee = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const employee = await userRepository.findById(req.params.id, { organizationId, role: 'ORG_USER' });
  if (!employee) {
    throw new ApiError(404, 'Employee not found');
  }
  const roleName = await resolveRoleName(employee);
  const departmentName = await resolveDepartmentName(employee);
  const tags = await lifecycleTags(req, [employee._id as Types.ObjectId]);
  res.status(200).json(
    successResponse(
      serialize(employee, roleName, departmentName, await resolveManagerName(employee), req.user!.role === 'ORG_ADMIN', tags.get(employee._id.toString()) ?? null)
    )
  );
});

export const updateEmployee = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const existing = await userRepository.findById(req.params.id, { organizationId, role: 'ORG_USER' });
  if (!existing) {
    throw new ApiError(404, 'Employee not found');
  }
  if (req.body.roleId) {
    const role = await roleRepository.findById(req.body.roleId, { organizationId });
    if (!role) {
      throw new ApiError(404, 'Role not found in your organization');
    }
  }
  if (req.body.department) {
    await assertDepartmentInOrg(req.body.department, organizationId);
  }
  // Only a new manager is checked, so an unchanged one who has since been disabled doesn't block other edits.
  if (req.body.reportsTo && req.body.reportsTo !== existing.reportsTo?.toString()) {
    await assertValidManager(req.body.reportsTo, req.params.id, organizationId);
  }
  if (req.body.email && req.body.email.toLowerCase() !== existing.email) {
    const clash = await userRepository.findByEmail(req.body.email);
    if (clash) {
      throw emailTakenError();
    }
  }
  try {
    const updated = await userRepository.updateById(req.params.id, req.body, req.user!.id);
    await auditCrud(req, 'update', 'employees', { id: req.params.id, label: updated!.name });
    const roleName = await resolveRoleName(updated!);
    const departmentName = await resolveDepartmentName(updated!);
    res.status(200).json(successResponse(serialize(updated!, roleName, departmentName, await resolveManagerName(updated!))));
  } catch (err) {
    if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) {
      throw emailTakenError();
    }
    throw err;
  }
});

export const deleteEmployee = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const existing = await userRepository.findById(req.params.id, { organizationId, role: 'ORG_USER' });
  if (!existing) {
    throw new ApiError(404, 'Employee not found');
  }
  const directReports = await userRepository.count({ organizationId, reportsTo: req.params.id });
  if (directReports > 0) {
    throw new ApiError(400, "Reassign this employee's direct reports to another manager first");
  }
  await userRepository.softDelete(req.params.id, req.user!.id);
  await cancelProcessesFor(organizationId, req.params.id, req.user!.id, 'Employee removed');
  await auditCrud(req, 'delete', 'employees', { id: req.params.id, label: existing.name });
  res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});
