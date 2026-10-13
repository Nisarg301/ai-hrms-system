import { Types } from 'mongoose';
import { ExpenseCategoryModel, IExpenseCategory } from '../models/expenseCategory.model';
import { ClaimStatus, ExpenseClaimModel, IExpenseClaim } from '../models/expenseClaim.model';
import { CounterModel } from '../models/counter.model';
import { DepartmentModel } from '../models/department.model';
import { UserModel } from '../models/user.model';
import { ExpenseItemModel, IExpenseItem } from '../models/expenseItem.model';
import { deleteFile, downloadFile, uploadFile } from './gridfs.service';
import { ApiError } from '../utils/apiResponse';
import { addDays } from '../utils/dates';

type Id = Types.ObjectId | string;
const oid = (id: Id) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

/** At most this many expenses in one claim (spec default 1). */
export const MAX_ITEMS_PER_CLAIM = 20;
/** At most this many receipt files per expense. */
export const MAX_RECEIPTS_PER_ITEM = 5;
/** An expense can be at most this many days old (spec default 1). */
export const MAX_EXPENSE_AGE_DAYS = 90;
/** ₹10,00,000 in paise: the largest single expense. */
export const MAX_AMOUNT_PAISE = 100_000_000;

export function fieldError(field: string, message: string): ApiError {
  return new ApiError(400, message, { fieldErrors: { [field]: [message] } });
}

// ---------------------------------------------------------------- categories

const DEFAULT_CATEGORIES = ['Travel', 'Food & meals', 'Accommodation', 'Internet & phone', 'Office supplies', 'Other'];

/**
 * Creates the default categories the first time an organization's expenses are
 * used; never again (deleted ones count). Safe under concurrent first calls: the
 * unique name index turns the loser's insert into a harmless duplicate error.
 */
export async function ensureDefaultCategories(organizationId: Id): Promise<void> {
  const org = oid(organizationId);
  if ((await ExpenseCategoryModel.countDocuments({ organizationId: org })) > 0) return;
  try {
    await ExpenseCategoryModel.insertMany(
      DEFAULT_CATEGORIES.map((name) => ({ organizationId: org, name, nameKey: name.toLowerCase() })),
      { ordered: false }
    );
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
  }
}

/** Over the category's per-expense limit (allowed, but flagged: E3). */
export function isOverLimit(amountPaise: number, category: Pick<IExpenseCategory, 'limitPaise'> | null): boolean {
  return category?.limitPaise != null && amountPaise > category.limitPaise;
}

/** The category wants a receipt for this amount (above its threshold; a threshold of 0 = always). */
export function needsReceipt(amountPaise: number, category: Pick<IExpenseCategory, 'receiptRequiredAbovePaise'> | null): boolean {
  return category !== null && amountPaise > category.receiptRequiredAbovePaise;
}

// ---------------------------------------------------------------- claims

/** A claim of mine that I'm about to change: it must exist, be mine, and still be a draft. */
export async function ownDraft(organizationId: Id, claimId: string, employeeId: string): Promise<IExpenseClaim> {
  const claim = await ExpenseClaimModel.findOne({ _id: claimId, organizationId: oid(organizationId), employeeId: oid(employeeId), isDeleted: false });
  if (!claim) throw new ApiError(404, 'Expense claim not found');
  if (claim.status !== 'draft') throw new ApiError(409, 'Only a draft can be changed');
  return claim;
}

/**
 * A claim I may look at: my own; or, for an ORG_ADMIN, anyone's once submitted
 * (someone else's draft is still their private work in progress).
 */
export async function viewableClaim(organizationId: Id, claimId: string, user: { id: string; role: string }): Promise<IExpenseClaim> {
  const mine = { employeeId: oid(user.id) };
  const claim = await ExpenseClaimModel.findOne({
    _id: claimId,
    organizationId: oid(organizationId),
    isDeleted: false,
    ...(user.role === 'ORG_ADMIN' ? { $or: [mine, { status: { $ne: 'draft' } }] } : mine),
  });
  if (!claim) throw new ApiError(404, 'Expense claim not found');
  return claim;
}

export function liveItems(claimId: Id): Promise<IExpenseItem[]> {
  return ExpenseItemModel.find({ claimId: oid(claimId), isDeleted: false }).sort({ date: 1, _id: 1 });
}

/** Keeps a claim's total and item count in step with its live items. */
export async function recalculate(claimId: Id): Promise<IExpenseClaim | null> {
  const [row] = await ExpenseItemModel.aggregate<{ total: number; count: number }>([
    { $match: { claimId: oid(claimId), isDeleted: false } },
    { $group: { _id: null, total: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
  ]);
  return ExpenseClaimModel.findOneAndUpdate(
    { _id: oid(claimId) },
    { $set: { totalPaise: row?.total ?? 0, itemCount: row?.count ?? 0 } },
    { returnDocument: 'after' }
  );
}

// ---------------------------------------------------------------- items

export interface ItemInput {
  date: string;
  categoryId: string;
  amountPaise: number;
  merchant: string;
  note: string;
}

/**
 * The rules for one expense: an active category of this organization, and a date
 * that's not in the future and at most 90 days old. Returns the category.
 */
export async function checkItem(organizationId: Id, input: Pick<ItemInput, 'date' | 'categoryId'>, today: string): Promise<IExpenseCategory> {
  if (input.date > today) throw fieldError('date', "An expense can't be in the future");
  if (input.date < addDays(today, -MAX_EXPENSE_AGE_DAYS)) {
    throw fieldError('date', `Expenses can be claimed up to ${MAX_EXPENSE_AGE_DAYS} days after they happen`);
  }
  const category = Types.ObjectId.isValid(input.categoryId)
    ? await ExpenseCategoryModel.findOne({ _id: input.categoryId, organizationId: oid(organizationId), isActive: true, isDeleted: false })
    : null;
  if (!category) throw fieldError('categoryId', 'Choose an active category');
  return category;
}

/** Removes receipt files from storage; a missing file isn't an error. */
export async function removeReceiptFiles(items: Pick<IExpenseItem, 'receipts'>[]): Promise<void> {
  for (const item of items) {
    for (const r of item.receipts) {
      await deleteFile(r.fileId).catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------- workflow

/** "₹1,95,050.50" for 19505050 paise. */
export function formatInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The next claim number for an organization and year: EXP-2026-0001, -0002, …
 * One atomic counter per organization per year; numbers are never reused (a
 * number stays with its claim through withdraw and resubmit).
 */
export async function nextClaimNumber(organizationId: Id, year: string): Promise<string> {
  const filter = { organizationId: oid(organizationId), key: `expense-${year}` };
  const bump = () => CounterModel.findOneAndUpdate(filter, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after' });
  let counter;
  try {
    counter = await bump();
  } catch (err) {
    // Two first-ever submits of the year can race to create the counter; the loser retries.
    if ((err as { code?: number }).code !== 11000) throw err;
    counter = await bump();
  }
  return `EXP-${year}-${String(counter!.value).padStart(4, '0')}`;
}

/** Moves a claim between states in one atomic update; a stale move gets 409 with the current state. */
async function transition(
  organizationId: Id,
  claimId: string,
  from: ClaimStatus,
  set: Record<string, unknown>,
  extraFilter: Record<string, unknown> = {}
): Promise<IExpenseClaim> {
  const filter = { _id: claimId, organizationId: oid(organizationId), isDeleted: false, ...extraFilter };
  const updated = await ExpenseClaimModel.findOneAndUpdate({ ...filter, status: from }, { $set: set }, { returnDocument: 'after' });
  if (updated) return updated;
  const current = await ExpenseClaimModel.findOne(filter);
  if (!current) throw new ApiError(404, 'Expense claim not found');
  throw new ApiError(409, `This claim is already ${current.status}`);
}

/**
 * Submits my draft. Everything is checked again, since categories and dates may
 * have moved on since the expenses were entered:
 * - at least one expense (and at most 20)
 * - every date not in the future and at most 90 days old
 * - every category still active
 * - a receipt wherever the category asks for one
 * Over-limit expenses are allowed but flagged for the approver (E3).
 */
export async function submitClaim(organizationId: Id, claimId: string, employeeId: string, today: string): Promise<IExpenseClaim> {
  const claim = await ownDraft(organizationId, claimId, employeeId);
  const items = await liveItems(claim._id as Types.ObjectId);
  if (items.length === 0) throw new ApiError(400, 'Add at least one expense before submitting');
  if (items.length > MAX_ITEMS_PER_CLAIM) throw new ApiError(400, `A claim can have at most ${MAX_ITEMS_PER_CLAIM} expenses`);

  const categories = await ExpenseCategoryModel.find({ _id: { $in: items.map((i) => i.categoryId) } });
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  const problems: { itemId: string; merchant: string; message: string }[] = [];
  for (const item of items) {
    const category = byId.get(String(item.categoryId)) ?? null;
    const problem =
      item.date > today
        ? "is dated in the future"
        : item.date < addDays(today, -MAX_EXPENSE_AGE_DAYS)
          ? `is more than ${MAX_EXPENSE_AGE_DAYS} days old`
          : !category || !category.isActive || category.isDeleted
            ? 'has a category that is no longer in use'
            : needsReceipt(item.amountPaise, category) && item.receipts.length === 0
              ? 'needs a receipt'
              : null;
    if (problem) problems.push({ itemId: String(item._id), merchant: item.merchant, message: `${item.merchant} (${item.date}) ${problem}` });
  }
  if (problems.length) {
    throw new ApiError(400, problems.length === 1 ? problems[0].message : `${problems.length} expenses need attention: ${problems[0].message}, …`, { problems });
  }

  // The flag the approver sees is fixed at submission.
  await ExpenseItemModel.bulkWrite(
    items.map((item) => ({
      updateOne: { filter: { _id: item._id }, update: { $set: { overLimit: isOverLimit(item.amountPaise, byId.get(String(item.categoryId)) ?? null) } } },
    }))
  );
  const submitted = await transition(
    organizationId,
    claimId,
    'draft',
    { status: 'submitted', submittedAt: new Date(), updatedBy: oid(employeeId) },
    { employeeId: oid(employeeId) }
  );
  // A resubmitted claim keeps its number; a first submit gets the next one.
  if (!submitted.number) {
    submitted.number = await nextClaimNumber(organizationId, today.slice(0, 4));
    await ExpenseClaimModel.updateOne({ _id: submitted._id }, { $set: { number: submitted.number } });
  }
  return submitted;
}

/** Takes my submitted claim back to a draft to change it, until it's decided. */
export function withdrawClaim(organizationId: Id, claimId: string, employeeId: string): Promise<IExpenseClaim> {
  return transition(organizationId, claimId, 'submitted', { status: 'draft', submittedAt: null, updatedBy: oid(employeeId) }, { employeeId: oid(employeeId) });
}

/** ORG_ADMIN: approve (optional note) or reject (note required, checked by the validator). */
export function decideClaim(organizationId: Id, claimId: string, adminId: string, decision: 'approved' | 'rejected', note: string): Promise<IExpenseClaim> {
  return transition(organizationId, claimId, 'submitted', {
    status: decision,
    decidedBy: oid(adminId),
    decidedAt: new Date(),
    decisionNote: note,
    updatedBy: oid(adminId),
  });
}

export interface PayResult {
  paid: IExpenseClaim[];
  skipped: { id: string; number: string | null; reason: string }[];
}

/**
 * ORG_ADMIN: records the payment of approved claims (the money goes out by bank
 * transfer outside the app). Each claim moves approved → paid atomically; any that
 * aren't approved any more are skipped with the reason.
 */
export async function payClaims(organizationId: Id, claimIds: string[], adminId: string, paidOn: string, reference: string): Promise<PayResult> {
  const result: PayResult = { paid: [], skipped: [] };
  for (const id of [...new Set(claimIds)]) {
    try {
      result.paid.push(
        await transition(organizationId, id, 'approved', {
          status: 'paid',
          paidBy: oid(adminId),
          paidAt: new Date(),
          paidOn,
          paymentReference: reference,
          updatedBy: oid(adminId),
        })
      );
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      const current = await ExpenseClaimModel.findOne({ _id: id, organizationId: oid(organizationId), isDeleted: false });
      result.skipped.push({ id, number: current?.number ?? null, reason: current ? `It's ${current.status}, not approved` : 'Not found' });
    }
  }
  return result;
}

/** Copies a GridFS file (a receipt) so the copy can be removed on its own. */
async function copyStoredFile(fileId: Types.ObjectId, filename: string, contentType: string): Promise<Types.ObjectId> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    downloadFile(fileId)
      .on('data', (chunk: Buffer) => chunks.push(chunk))
      .on('error', reject)
      .on('end', () => resolve());
  });
  return uploadFile({ buffer: Buffer.concat(chunks), filename, contentType });
}

/**
 * Copies any claim of mine (typically a rejected one) into a new draft, expenses
 * and receipts included, to fix and submit again.
 */
export async function copyClaim(organizationId: Id, claimId: string, employeeId: string): Promise<IExpenseClaim> {
  const source = await ExpenseClaimModel.findOne({ _id: claimId, organizationId: oid(organizationId), employeeId: oid(employeeId), isDeleted: false });
  if (!source) throw new ApiError(404, 'Expense claim not found');
  const me = oid(employeeId);
  const copy = await ExpenseClaimModel.create({
    organizationId: oid(organizationId),
    employeeId: me,
    title: source.title,
    copiedFrom: source._id,
    createdBy: me,
    updatedBy: me,
  });
  for (const item of await liveItems(source._id as Types.ObjectId)) {
    const receipts = [];
    for (const r of item.receipts) {
      receipts.push({ fileId: await copyStoredFile(r.fileId, r.originalName, r.mimeType), originalName: r.originalName, mimeType: r.mimeType, size: r.size });
    }
    await ExpenseItemModel.create({
      claimId: copy._id,
      organizationId: oid(organizationId),
      date: item.date,
      categoryId: item.categoryId,
      amountPaise: item.amountPaise,
      merchant: item.merchant,
      note: item.note,
      receipts,
      createdBy: me,
      updatedBy: me,
    });
  }
  return (await recalculate(copy._id as Types.ObjectId))!;
}

// ---------------------------------------------------------------- admin views

/** This month so far: the default range for the summary and the export. */
export function defaultRange(today: string, range: { from?: string; to?: string }): { from: string; to: string } {
  return { from: range.from ?? `${today.slice(0, 7)}-01`, to: range.to ?? today };
}

/**
 * Claim ids with at least one live expense matching the filters (category and/or
 * expense-date range), or null when no item filter was asked for.
 */
export async function claimIdsWithItems(
  organizationId: Id,
  filters: { categoryId?: string; from?: string; to?: string }
): Promise<Types.ObjectId[] | null> {
  if (!filters.categoryId && !filters.from && !filters.to) return null;
  const date: Record<string, string> = {};
  if (filters.from) date.$gte = filters.from;
  if (filters.to) date.$lte = filters.to;
  return ExpenseItemModel.distinct('claimId', {
    organizationId: oid(organizationId),
    isDeleted: false,
    ...(filters.categoryId ? { categoryId: oid(filters.categoryId) } : {}),
    ...(Object.keys(date).length ? { date } : {}),
  });
}

/** How many expenses on each claim went over their limit (for the approver's list). */
export async function overLimitCounts(claimIds: Types.ObjectId[]): Promise<Map<string, number>> {
  if (claimIds.length === 0) return new Map();
  const rows = await ExpenseItemModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { claimId: { $in: claimIds }, isDeleted: false, overLimit: true } },
    { $group: { _id: '$claimId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

export interface ExpenseSummary {
  from: string;
  to: string;
  /** Approved and paid expenses dated in the range. */
  approvedPaise: number;
  paidPaise: number;
  byCategory: { categoryId: string; name: string; totalPaise: number; count: number }[];
  byDepartment: { departmentId: string | null; name: string; totalPaise: number; count: number }[];
  /** Right now, whatever the range. */
  awaitingApproval: { count: number; totalPaise: number };
  awaitingPayment: { count: number; totalPaise: number };
}

/**
 * What's been spent: approved and paid expenses dated within [from, to], by
 * category and by the claimant's department; plus what's waiting for approval or
 * payment right now.
 */
export async function expenseSummary(organizationId: Id, from: string, to: string): Promise<ExpenseSummary> {
  const org = oid(organizationId);
  const [facets] = await ExpenseItemModel.aggregate<{
    byCategory: { _id: Types.ObjectId; totalPaise: number; count: number }[];
    byDepartment: { _id: Types.ObjectId | null; totalPaise: number; count: number }[];
    byStatus: { _id: 'approved' | 'paid'; totalPaise: number }[];
  }>([
    { $match: { organizationId: org, isDeleted: false, date: { $gte: from, $lte: to } } },
    { $lookup: { from: ExpenseClaimModel.collection.name, localField: 'claimId', foreignField: '_id', as: 'claim' } },
    { $unwind: '$claim' },
    { $match: { 'claim.isDeleted': false, 'claim.status': { $in: ['approved', 'paid'] } } },
    { $lookup: { from: UserModel.collection.name, localField: 'claim.employeeId', foreignField: '_id', as: 'employee' } },
    { $unwind: { path: '$employee', preserveNullAndEmptyArrays: true } },
    {
      $facet: {
        byCategory: [{ $group: { _id: '$categoryId', totalPaise: { $sum: '$amountPaise' }, count: { $sum: 1 } } }],
        byDepartment: [{ $group: { _id: { $ifNull: ['$employee.department', null] }, totalPaise: { $sum: '$amountPaise' }, count: { $sum: 1 } } }],
        byStatus: [{ $group: { _id: '$claim.status', totalPaise: { $sum: '$amountPaise' } } }],
      },
    },
  ]);
  const waiting = await ExpenseClaimModel.aggregate<{ _id: 'submitted' | 'approved'; count: number; totalPaise: number }>([
    { $match: { organizationId: org, isDeleted: false, status: { $in: ['submitted', 'approved'] } } },
    { $group: { _id: '$status', count: { $sum: 1 }, totalPaise: { $sum: '$totalPaise' } } },
  ]);

  // Names straight from the models, so deleted or inactive ones still read right.
  const categories = await ExpenseCategoryModel.find({ _id: { $in: facets.byCategory.map((c) => c._id) } }, { name: 1 });
  const categoryNames = new Map(categories.map((c) => [String(c._id), c.name]));
  const deptIds = facets.byDepartment.map((d) => d._id).filter((id): id is Types.ObjectId => id !== null);
  const departments = deptIds.length ? await DepartmentModel.find({ _id: { $in: deptIds } }, { title: 1 }) : [];
  const deptNames = new Map(departments.map((d) => [String(d._id), d.title]));
  const status = (s: 'approved' | 'paid') => facets.byStatus.find((x) => x._id === s)?.totalPaise ?? 0;
  const wait = (s: 'submitted' | 'approved') => {
    const row = waiting.find((x) => x._id === s);
    return { count: row?.count ?? 0, totalPaise: row?.totalPaise ?? 0 };
  };
  const byTotal = <T extends { totalPaise: number; name: string }>(a: T, b: T) => b.totalPaise - a.totalPaise || a.name.localeCompare(b.name);

  return {
    from,
    to,
    approvedPaise: status('approved') + status('paid'),
    paidPaise: status('paid'),
    byCategory: facets.byCategory
      .map((c) => ({ categoryId: String(c._id), name: categoryNames.get(String(c._id)) ?? 'Unknown', totalPaise: c.totalPaise, count: c.count }))
      .sort(byTotal),
    byDepartment: facets.byDepartment
      .map((d) => ({
        departmentId: d._id ? String(d._id) : null,
        name: d._id ? (deptNames.get(String(d._id)) ?? 'Unknown') : 'No department',
        totalPaise: d.totalPaise,
        count: d.count,
      }))
      .sort(byTotal),
    awaitingApproval: wait('submitted'),
    awaitingPayment: wait('approved'),
  };
}
