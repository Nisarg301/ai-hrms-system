import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { ModuleName } from '../constants/modules';
import { hasPermission } from '../permissions/checkPermission';
import { roleRepository } from '../repositories/role.repository';
import { userRepository } from '../repositories/user.repository';
import { departmentRepository } from '../repositories/department.repository';
import { documentRepository } from '../repositories/document.repository';
import { projectRepository } from '../repositories/project.repository';
import { taskRepository } from '../repositories/task.repository';
import { ApiError } from '../utils/apiResponse';
import { CsvCell, toCsv } from '../utils/csv';
import { daysFor } from '../services/attendance.service';
import { activeMembers, departmentNameMap } from '../services/people.service';
import { monthQuerySchema } from '../validators/attendance.validators';
import { rangeQuerySchema } from '../validators/expense.validators';
import { defaultRange } from '../services/expense.service';
import { ExpenseClaimModel } from '../models/expenseClaim.model';
import { ExpenseItemModel } from '../models/expenseItem.model';
import { ExpenseCategoryModel } from '../models/expenseCategory.model';
import { UserModel } from '../models/user.model';
import { DepartmentModel } from '../models/department.model';
import { minutesOfDay, minutesToHm, monthRange, now, todayIso } from '../utils/dates';
import { ReviewModel } from '../models/review.model';
import { cycleForAdmin, partStatus, PartStatus } from '../services/performance.service';
import { exportReviewsQuerySchema } from '../validators/performance.validators';

export const EXPORTABLE_MODULES = ['employees', 'documents', 'projects', 'tasks'] as const;
type ExportableModule = (typeof EXPORTABLE_MODULES)[number];

type Table = { headers: string[]; rows: CsvCell[][] };

function nameMap<T extends { _id: unknown }>(items: T[], pick: (item: T) => string): Map<string, string> {
  return new Map(items.map((item) => [String(item._id), pick(item)]));
}

// Every exporter returns all of the organization's non-deleted records, newest
// first. Repository find() already excludes soft-deleted rows.
const exporters: Record<ExportableModule, (organizationId: Types.ObjectId) => Promise<Table>> = {
  async employees(organizationId) {
    const [users, roles, departments] = await Promise.all([
      userRepository.find({ organizationId, role: 'ORG_USER' }),
      roleRepository.find({ organizationId }),
      departmentRepository.find({ organizationId }),
    ]);
    const roleNames = nameMap(roles, (r) => r.name);
    const departmentNames = nameMap(departments, (d) => d.title);
    return {
      headers: ['Name', 'Email', 'Job title', 'Department', 'Role', 'Status'],
      rows: newestFirst(users).map((u) => [
        u.name,
        u.email,
        u.jobTitle,
        u.department ? departmentNames.get(u.department.toString()) : '',
        u.roleId ? roleNames.get(u.roleId.toString()) : '',
        u.status,
      ]),
    };
  },

  async documents(organizationId) {
    const documents = await documentRepository.find({ organizationId });
    return {
      headers: ['Title', 'Description', 'Category', 'Status', 'File name'],
      rows: newestFirst(documents).map((d) => [d.title, d.description, d.category, d.status, d.file?.id ? d.file.originalName : '']),
    };
  },

  async projects(organizationId) {
    const projects = await projectRepository.find({ organizationId });
    return {
      headers: ['Name', 'Description', 'Deadline', 'Status'],
      rows: newestFirst(projects).map((p) => [p.name, p.description, p.deadline ? p.deadline.toISOString().slice(0, 10) : '', p.status]),
    };
  },

  async tasks(organizationId) {
    const [tasks, projects, users] = await Promise.all([
      taskRepository.find({ organizationId }),
      projectRepository.find({ organizationId }),
      userRepository.find({ organizationId }),
    ]);
    const projectNames = nameMap(projects, (p) => p.name);
    const userNames = nameMap(users, (u) => u.name);
    return {
      headers: ['Title', 'Description', 'Due date', 'Status', 'Project', 'Members'],
      rows: newestFirst(tasks).map((t) => [
        t.title,
        t.description,
        t.dueDate,
        t.status,
        t.projectId ? projectNames.get(t.projectId.toString()) : '',
        (t.userId ?? []).map((id) => userNames.get(id.toString()) ?? 'Unknown').join(', '),
      ]),
    };
  },
};

function newestFirst<T extends { createdAt: Date }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export const exportModule = asyncHandler(async (req: Request, res: Response) => {
  const module = req.params.module as ExportableModule;
  if (!EXPORTABLE_MODULES.includes(module)) {
    throw new ApiError(404, 'Nothing to export for this module');
  }
  // 'exports: read' alone is not enough: you can only export data you can read.
  const role = req.user!.roleId ? await roleRepository.findById(req.user!.roleId) : null;
  if (!hasPermission(req.user!, role, module as ModuleName, 'read')) {
    throw new ApiError(403, `Missing 'read' permission on '${module}'`);
  }

  const { headers, rows } = await exporters[module](req.orgFilter!.organizationId);
  const filename = `${module}-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(toCsv(headers, rows));
});

const STATUS_LABELS: Record<string, string> = {
  present: 'Present',
  half_day: 'Half day',
  absent: 'Absent',
  on_leave: 'On leave',
  holiday: 'Holiday',
  weekend: 'Weekend',
  worked_on_off_day: 'Worked on day off',
  in_progress: 'In progress',
  not_in_yet: 'Not in yet',
  missing_clock_out: 'Missing clock-out',
  upcoming: 'Upcoming',
  not_joined: 'Not joined yet',
};

const time = (d: Date | null) => (d ? minutesToHm(minutesOfDay(d)) : '');

/**
 * Professional, ORG_ADMIN: one row per person per day up to today, skipping
 * weekends and holidays nobody worked on, and days before someone joined
 * (?month=YYYY-MM, default this month).
 */
export const exportAttendance = asyncHandler(async (req: Request, res: Response) => {
  const parsed = monthQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  const organizationId = req.orgFilter!.organizationId;
  const at = now();
  const today = todayIso(at);
  const month = parsed.data.month ?? today.slice(0, 7);
  const { from, to } = monthRange(month);
  const [members, departmentNames] = await Promise.all([activeMembers(organizationId), departmentNameMap(organizationId)]);
  const people = [...members].sort((a, b) => a.name.localeCompare(b.name));
  const days = await daysFor(organizationId, people.map((p) => p._id as Types.ObjectId), from, to < today ? to : today, at);

  const rows: CsvCell[][] = [];
  for (const p of people) {
    for (const d of days.get(String(p._id)) ?? []) {
      if ((d.status === 'weekend' || d.status === 'holiday') && d.workedMinutes === 0) continue;
      if (d.status === 'not_joined') continue;
      rows.push([
        d.date,
        p.name,
        p.email,
        p.department ? departmentNames.get(String(p.department)) : '',
        STATUS_LABELS[d.status] ?? d.status,
        time(d.firstIn),
        time(d.lastOut),
        (d.workedMinutes / 60).toFixed(2),
        d.late ? 'Yes' : '',
        d.wfh ? 'Yes' : '',
        d.leave ? `${d.leave.typeName}${d.leave.halfDay ? ` (${d.leave.halfDay} half)` : ''}` : '',
      ]);
    }
  }
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${month}.csv"`);
  res.status(200).send(
    toCsv(['Date', 'Employee', 'Email', 'Department', 'Status', 'First in', 'Last out', 'Hours', 'Late', 'WFH', 'Leave'], rows)
  );
});

/** Rupees with two decimals and no grouping, so spreadsheets read it as a number: 1950.50 */
const rupees = (paise: number) => (paise / 100).toFixed(2);

/**
 * Professional, ORG_ADMIN: one row per expense on submitted, approved, rejected
 * or paid claims, dated within ?from=&to= (default: this month). Drafts never.
 */
export const exportExpenses = asyncHandler(async (req: Request, res: Response) => {
  const parsed = rangeQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  const organizationId = req.orgFilter!.organizationId;
  const { from, to } = defaultRange(todayIso(), parsed.data);
  if (from > to) throw new ApiError(400, "The end date can't be before the start date");

  const items = await ExpenseItemModel.find({ organizationId, isDeleted: false, date: { $gte: from, $lte: to } });
  const claims = await ExpenseClaimModel.find({
    _id: { $in: [...new Set(items.map((i) => String(i.claimId)))] },
    organizationId,
    isDeleted: false,
    status: { $ne: 'draft' },
  });
  const claimById = new Map(claims.map((c) => [String(c._id), c]));
  const userIds = [...new Set(claims.flatMap((c) => [c.employeeId, c.decidedBy].filter(Boolean).map(String)))];
  const [users, categories] = await Promise.all([
    userIds.length ? UserModel.find({ _id: { $in: userIds } }, { name: 1, email: 1, department: 1 }) : [],
    ExpenseCategoryModel.find({ organizationId }, { name: 1 }),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const deptIds = [...new Set(users.map((u) => u.department).filter(Boolean).map(String))];
  const departments = deptIds.length ? await DepartmentModel.find({ _id: { $in: deptIds } }, { title: 1 }) : [];
  const deptNames = new Map(departments.map((d) => [String(d._id), d.title]));
  const categoryNames = new Map(categories.map((c) => [String(c._id), c.name]));

  const rows: CsvCell[][] = [];
  for (const item of items) {
    const claim = claimById.get(String(item.claimId));
    if (!claim) continue; // a draft, or deleted
    const employee = userById.get(String(claim.employeeId));
    rows.push([
      claim.number,
      claim.title,
      employee?.name ?? 'Former member',
      employee?.email ?? '',
      employee?.department ? deptNames.get(String(employee.department)) : '',
      item.date,
      categoryNames.get(String(item.categoryId)) ?? '',
      item.merchant,
      item.note,
      rupees(item.amountPaise),
      item.overLimit ? 'Yes' : '',
      claim.status,
      claim.submittedAt ? todayIso(claim.submittedAt) : '',
      claim.decidedBy ? (userById.get(String(claim.decidedBy))?.name ?? '') : '',
      claim.paidOn ?? '',
      claim.paymentReference,
    ]);
  }
  rows.sort((a, b) => String(a[5]).localeCompare(String(b[5])) || String(a[0]).localeCompare(String(b[0])));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="expenses-${from}-to-${to}.csv"`);
  res.status(200).send(
    toCsv(
      ['Claim', 'Title', 'Employee', 'Email', 'Department', 'Date', 'Category', 'Merchant', 'Note', 'Amount (INR)', 'Over limit', 'Status', 'Submitted on', 'Decided by', 'Paid on', 'Payment reference'],
      rows
    )
  );
});

const PART_STATUS_LABEL: Record<PartStatus, string> = { not_started: 'Not started', draft: 'Draft', submitted: 'Submitted' };

/**
 * One row per participant in a review cycle: department, reviewer, both parts' status and
 * rating (submitted only), and whether it's released. Answers stay in the app.
 */
export const exportReviews = asyncHandler(async (req: Request, res: Response) => {
  const parsed = exportReviewsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  const organizationId = req.orgFilter!.organizationId;
  const cycle = await cycleForAdmin(organizationId, parsed.data.cycleId);
  const reviews = await ReviewModel.find({ cycleId: cycle._id });
  const ids = [...new Set(reviews.flatMap((r) => [r.employeeId, r.reviewerId]).filter(Boolean).map(String))];
  const [users, departmentNames] = await Promise.all([UserModel.find({ _id: { $in: ids }, organizationId }), departmentNameMap(organizationId)]);
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const rows: CsvCell[][] = reviews
    .map((r) => {
      const employee = byId.get(String(r.employeeId));
      return [
        employee?.name ?? 'Former member',
        employee?.email ?? '',
        r.departmentId ? departmentNames.get(String(r.departmentId)) : '',
        r.reviewerId ? (byId.get(String(r.reviewerId))?.name ?? 'Former member') : 'Admins',
        PART_STATUS_LABEL[partStatus(r.self)],
        r.self.submittedAt ? r.self.rating : '',
        PART_STATUS_LABEL[partStatus(r.manager)],
        r.manager.submittedAt ? r.manager.rating : '',
        r.releasedAt ? 'Yes' : '',
      ];
    })
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const slug = cycle.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cycle';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="reviews-${slug}.csv"`);
  res
    .status(200)
    .send(toCsv(['Employee', 'Email', 'Department', 'Reviewer', 'Self review', 'Self rating', 'Manager review', 'Manager rating', 'Released'], rows));
});
