import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../middlewares/asyncHandler';
import { ExpenseCategoryModel, IExpenseCategory } from '../models/expenseCategory.model';
import { ExpenseClaimModel, IExpenseClaim } from '../models/expenseClaim.model';
import { ExpenseItemModel, IExpenseItem } from '../models/expenseItem.model';
import { UserModel } from '../models/user.model';
import {
  checkItem,
  claimIdsWithItems,
  copyClaim,
  defaultRange,
  expenseSummary,
  overLimitCounts,
  decideClaim,
  formatInr,
  isOverLimit,
  liveItems,
  MAX_ITEMS_PER_CLAIM,
  MAX_RECEIPTS_PER_ITEM,
  needsReceipt,
  ownDraft,
  payClaims,
  recalculate,
  removeReceiptFiles,
  submitClaim,
  viewableClaim,
  withdrawClaim,
} from '../services/expense.service';
import { auditCrud } from '../services/audit.service';
import { mailerService } from '../services/mailer.service';
import { notify } from '../services/notification.service';
import { userRepository } from '../repositories/user.repository';
import { deleteFile, downloadFile, uploadFile } from '../services/gridfs.service';
import { adminListQuerySchema, myClaimsQuerySchema, rangeQuerySchema } from '../validators/expense.validators';
import { parsePaginationQuery } from '../utils/pagination';
import { successResponse, ApiError } from '../utils/apiResponse';
import { todayIso } from '../utils/dates';

// ---------------------------------------------------------------- views

async function namesFor(ids: (Types.ObjectId | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  // Straight from the model, so people who have since been deleted still show.
  const users = unique.length ? await UserModel.find({ _id: { $in: unique } }, { name: 1 }) : [];
  return new Map(users.map((u) => [String(u._id), u.name]));
}

function claimView(c: IExpenseClaim, names: Map<string, string>) {
  return {
    id: String(c._id),
    number: c.number,
    title: c.title,
    status: c.status,
    totalPaise: c.totalPaise,
    itemCount: c.itemCount,
    employeeId: String(c.employeeId),
    employeeName: names.get(String(c.employeeId)) ?? null,
    submittedAt: c.submittedAt,
    decidedByName: c.decidedBy ? (names.get(String(c.decidedBy)) ?? null) : null,
    decidedAt: c.decidedAt,
    decisionNote: c.decisionNote,
    paidByName: c.paidBy ? (names.get(String(c.paidBy)) ?? null) : null,
    paidAt: c.paidAt,
    paidOn: c.paidOn,
    paymentReference: c.paymentReference,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function itemView(item: IExpenseItem, categories: Map<string, IExpenseCategory>, isDraft: boolean) {
  const category = categories.get(String(item.categoryId)) ?? null;
  const receiptRequired = needsReceipt(item.amountPaise, category);
  return {
    id: String(item._id),
    date: item.date,
    categoryId: String(item.categoryId),
    categoryName: category?.name ?? null,
    amountPaise: item.amountPaise,
    merchant: item.merchant,
    note: item.note,
    receipts: item.receipts.map((r) => ({ id: String(r.fileId), originalName: r.originalName, mimeType: r.mimeType, size: r.size })),
    // A draft follows its category's current limit; once submitted, the flag is what was stored then.
    overLimit: isDraft ? isOverLimit(item.amountPaise, category) : item.overLimit,
    receiptRequired,
    missingReceipt: receiptRequired && item.receipts.length === 0,
  };
}

/** A claim with its items (categories include deleted/inactive ones, so old claims still read right). */
async function fullView(claim: IExpenseClaim) {
  const items = await liveItems(claim._id as Types.ObjectId);
  const categoryIds = [...new Set(items.map((i) => String(i.categoryId)))];
  const categories = categoryIds.length ? await ExpenseCategoryModel.find({ _id: { $in: categoryIds } }) : [];
  const categoryMap = new Map(categories.map((c) => [String(c._id), c]));
  const names = await namesFor([claim.employeeId, claim.decidedBy, claim.paidBy]);
  return { ...claimView(claim, names), items: items.map((i) => itemView(i, categoryMap, claim.status === 'draft')) };
}

// ---------------------------------------------------------------- claims

export const myClaims = asyncHandler(async (req: Request, res: Response) => {
  const parsed = myClaimsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  const claims = await ExpenseClaimModel.find({
    organizationId: req.orgFilter!.organizationId,
    employeeId: new Types.ObjectId(req.user!.id),
    isDeleted: false,
    ...(parsed.data.status ? { status: parsed.data.status } : {}),
  }).sort({ createdAt: -1, _id: -1 });
  const names = await namesFor(claims.flatMap((c) => [c.employeeId, c.decidedBy, c.paidBy]));
  res.status(200).json(successResponse(claims.map((c) => claimView(c, names))));
});

export const createClaim = asyncHandler(async (req: Request, res: Response) => {
  const me = new Types.ObjectId(req.user!.id);
  const claim = await ExpenseClaimModel.create({
    organizationId: req.orgFilter!.organizationId,
    employeeId: me,
    title: req.body.title,
    createdBy: me,
    updatedBy: me,
  });
  res.status(201).json(successResponse(await fullView(claim)));
});

export const getClaim = asyncHandler(async (req: Request, res: Response) => {
  const claim = await viewableClaim(req.orgFilter!.organizationId, req.params.id, req.user!);
  res.status(200).json(successResponse(await fullView(claim)));
});

export const renameClaim = asyncHandler(async (req: Request, res: Response) => {
  const claim = await ownDraft(req.orgFilter!.organizationId, req.params.id, req.user!.id);
  claim.title = req.body.title;
  claim.updatedBy = new Types.ObjectId(req.user!.id);
  await claim.save();
  res.status(200).json(successResponse(await fullView(claim)));
});

/** Deletes a draft with its items, and removes its receipts from storage. */
export const deleteClaim = asyncHandler(async (req: Request, res: Response) => {
  const claim = await ownDraft(req.orgFilter!.organizationId, req.params.id, req.user!.id);
  // Only a still-draft claim is deleted, even if it's being submitted at this moment.
  const deleted = await ExpenseClaimModel.findOneAndUpdate(
    { _id: claim._id, status: 'draft', isDeleted: false },
    { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: req.user!.id } }
  );
  if (!deleted) throw new ApiError(409, 'Only a draft can be changed');
  const items = await liveItems(claim._id as Types.ObjectId);
  await ExpenseItemModel.updateMany({ claimId: claim._id, isDeleted: false }, { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: req.user!.id } });
  await removeReceiptFiles(items);
  res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});

// ---------------------------------------------------------------- items

async function ownDraftItem(req: Request) {
  const claim = await ownDraft(req.orgFilter!.organizationId, req.params.id, req.user!.id);
  const item = await ExpenseItemModel.findOne({ _id: req.params.itemId, claimId: claim._id, isDeleted: false });
  if (!item) throw new ApiError(404, 'Expense not found');
  return { claim, item };
}

export const addItem = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const claim = await ownDraft(organizationId, req.params.id, req.user!.id);
  await checkItem(organizationId, req.body, todayIso());
  if ((await ExpenseItemModel.countDocuments({ claimId: claim._id, isDeleted: false })) >= MAX_ITEMS_PER_CLAIM) {
    throw new ApiError(400, `A claim can have at most ${MAX_ITEMS_PER_CLAIM} expenses. Start another claim.`);
  }
  await ExpenseItemModel.create({
    claimId: claim._id,
    organizationId,
    ...req.body,
    createdBy: req.user!.id,
    updatedBy: req.user!.id,
  });
  const updated = await recalculate(claim._id as Types.ObjectId);
  res.status(201).json(successResponse(await fullView(updated!)));
});

export const updateItem = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const { claim, item } = await ownDraftItem(req);
  const next = { date: item.date, categoryId: String(item.categoryId), ...req.body };
  await checkItem(organizationId, next, todayIso());
  await ExpenseItemModel.updateOne({ _id: item._id }, { $set: { ...req.body, updatedBy: req.user!.id } });
  const updated = await recalculate(claim._id as Types.ObjectId);
  res.status(200).json(successResponse(await fullView(updated!)));
});

export const deleteItem = asyncHandler(async (req: Request, res: Response) => {
  const { claim, item } = await ownDraftItem(req);
  await ExpenseItemModel.updateOne({ _id: item._id }, { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: req.user!.id } });
  await removeReceiptFiles([item]);
  const updated = await recalculate(claim._id as Types.ObjectId);
  res.status(200).json(successResponse(await fullView(updated!)));
});

// ---------------------------------------------------------------- receipts

export const addReceipt = asyncHandler(async (req: Request, res: Response) => {
  const { claim, item } = await ownDraftItem(req);
  const file = req.file;
  if (!file) throw new ApiError(400, 'Attach a receipt file');
  if (item.receipts.length >= MAX_RECEIPTS_PER_ITEM) {
    throw new ApiError(400, `At most ${MAX_RECEIPTS_PER_ITEM} receipts per expense`);
  }
  const fileId = await uploadFile({ buffer: file.buffer, filename: file.originalname, contentType: file.mimetype });
  const receipt = { fileId, originalName: file.originalname, mimeType: file.mimetype, size: file.size };
  // Atomic cap: two uploads at once can't take it past the limit.
  const updated = await ExpenseItemModel.findOneAndUpdate(
    { _id: item._id, isDeleted: false, [`receipts.${MAX_RECEIPTS_PER_ITEM - 1}`]: { $exists: false } },
    { $push: { receipts: receipt } }
  );
  if (!updated) {
    await deleteFile(fileId).catch(() => undefined);
    throw new ApiError(400, `At most ${MAX_RECEIPTS_PER_ITEM} receipts per expense`);
  }
  res.status(201).json(successResponse(await fullView(claim)));
});

/** Streams a receipt to its owner or an ORG_ADMIN, inline so images and PDFs preview. */
export const getReceipt = asyncHandler(async (req: Request, res: Response) => {
  const claim = await viewableClaim(req.orgFilter!.organizationId, req.params.id, req.user!);
  const item = await ExpenseItemModel.findOne({ _id: req.params.itemId, claimId: claim._id, isDeleted: false });
  const receipt = item?.receipts.find((r) => String(r.fileId) === req.params.fileId);
  if (!receipt) throw new ApiError(404, 'Receipt not found');
  res.setHeader('Content-Type', receipt.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(receipt.originalName)}"`);
  const stream = downloadFile(receipt.fileId);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ success: false, error: { message: 'Receipt file is missing' } });
  });
  stream.pipe(res);
});

export const deleteReceipt = asyncHandler(async (req: Request, res: Response) => {
  const { claim, item } = await ownDraftItem(req);
  const receipt = item.receipts.find((r) => String(r.fileId) === req.params.fileId);
  if (!receipt) throw new ApiError(404, 'Receipt not found');
  await ExpenseItemModel.updateOne({ _id: item._id }, { $pull: { receipts: { fileId: receipt.fileId } } });
  await deleteFile(receipt.fileId).catch(() => undefined);
  res.status(200).json(successResponse(await fullView(claim)));
});

// ---------------------------------------------------------------- workflow

/** "Submitted EXP-2026-0001 (₹1,950.50)" */
function auditLabel(what: string, c: IExpenseClaim): string {
  return `${what} ${c.number ?? 'draft'} (${formatInr(c.totalPaise)})`;
}

export const submit = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const claim = await submitClaim(organizationId, req.params.id, req.user!.id, todayIso());
  await auditCrud(req, 'update', 'expenses', { id: req.params.id, label: auditLabel('Submitted', claim) });

  const admins = await userRepository.find({ organizationId, role: 'ORG_ADMIN', status: 'active' });
  const employeeName = req.user!.name ?? 'An employee';
  for (const admin of admins) {
    await mailerService.sendExpenseSubmittedEmail(admin.email, {
      employeeName,
      number: claim.number!,
      title: claim.title,
      total: formatInr(claim.totalPaise),
      itemCount: claim.itemCount,
    });
  }
  await notify(
    organizationId,
    admins.map((a) => a._id as Types.ObjectId),
    {
      type: 'expense_submitted',
      title: `${employeeName} submitted an expense claim`,
      body: `${claim.number} · ${claim.title} · ${formatInr(claim.totalPaise)}`,
      link: '/leave/approvals?tab=expenses',
    },
    req.user!.id
  );
  res.status(200).json(successResponse(await fullView(claim)));
});

export const withdraw = asyncHandler(async (req: Request, res: Response) => {
  const claim = await withdrawClaim(req.orgFilter!.organizationId, req.params.id, req.user!.id);
  await auditCrud(req, 'update', 'expenses', { id: req.params.id, label: auditLabel('Withdrew', claim) });
  res.status(200).json(successResponse(await fullView(claim)));
});

export const copy = asyncHandler(async (req: Request, res: Response) => {
  const claim = await copyClaim(req.orgFilter!.organizationId, req.params.id, req.user!.id);
  res.status(201).json(successResponse(await fullView(claim)));
});

async function tellEmployee(req: Request, claim: IExpenseClaim, status: 'approved' | 'rejected' | 'paid') {
  const employee = await userRepository.findById(claim.employeeId);
  if (employee) {
    await mailerService.sendExpenseUpdateEmail(employee.email, {
      status,
      number: claim.number ?? '',
      title: claim.title,
      total: formatInr(claim.totalPaise),
      note: status === 'paid' ? '' : claim.decisionNote,
      paidOn: claim.paidOn ?? undefined,
      reference: claim.paymentReference || undefined,
    });
  }
  const body =
    status === 'paid'
      ? `${claim.number} · ${formatInr(claim.totalPaise)} · paid on ${claim.paidOn} (ref ${claim.paymentReference})`
      : [`${claim.number} · ${formatInr(claim.totalPaise)}`, claim.decisionNote ? `“${claim.decisionNote}”` : null].filter(Boolean).join(' · ');
  await notify(
    req.orgFilter!.organizationId,
    [claim.employeeId],
    {
      type: status === 'paid' ? 'expense_paid' : 'expense_decided',
      title: status === 'paid' ? `Your expense claim was paid: ${claim.title}` : `Your expense claim was ${status}: ${claim.title}`,
      body,
      link: '/me/expenses',
    },
    req.user!.id
  );
}

function decide(decision: 'approved' | 'rejected') {
  return asyncHandler(async (req: Request, res: Response) => {
    const claim = await decideClaim(req.orgFilter!.organizationId, req.params.id, req.user!.id, decision, req.body.note ?? '');
    await auditCrud(req, 'update', 'expenses', { id: req.params.id, label: auditLabel(decision === 'approved' ? 'Approved' : 'Rejected', claim) });
    await tellEmployee(req, claim, decision);
    res.status(200).json(successResponse(await fullView(claim)));
  });
}

export const approve = decide('approved');
export const reject = decide('rejected');

/** Records payment for one or many approved claims; reports any skipped and why. */
export const pay = asyncHandler(async (req: Request, res: Response) => {
  const { claimIds, paidOn, reference } = req.body;
  const { paid, skipped } = await payClaims(req.orgFilter!.organizationId, claimIds, req.user!.id, paidOn, reference);
  for (const claim of paid) {
    await auditCrud(req, 'update', 'expenses', { id: String(claim._id), label: `${auditLabel('Paid', claim)} ref ${reference}` });
    await tellEmployee(req, claim, 'paid');
  }
  const names = await namesFor(paid.flatMap((c) => [c.employeeId, c.decidedBy, c.paidBy]));
  res.status(200).json(
    successResponse({
      paid: paid.map((c) => claimView(c, names)),
      skipped,
      totalPaidPaise: paid.reduce((sum, c) => sum + c.totalPaise, 0),
    })
  );
});

// ---------------------------------------------------------------- admin

function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { flatten: () => unknown } } }, query: unknown): T {
  const parsed = schema.safeParse(query);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());
  return parsed.data;
}

/**
 * Everyone's claims except drafts, for ORG_ADMIN. Waiting claims come oldest first
 * (first come, first served); otherwise newest first. `from`/`to` and `categoryId`
 * match claims with at least one such expense.
 */
export const listClaims = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const { status, employeeId, categoryId, from, to } = parse(adminListQuerySchema, req.query);
  const { page, limit, skip } = parsePaginationQuery(req.query as Record<string, unknown>);

  const ids = await claimIdsWithItems(organizationId, { categoryId, from, to });
  const filter = {
    organizationId,
    isDeleted: false,
    status: status ?? { $ne: 'draft' as const },
    ...(employeeId ? { employeeId: new Types.ObjectId(employeeId) } : {}),
    ...(ids ? { _id: { $in: ids } } : {}),
  };
  const dir = status === 'submitted' ? 1 : -1;
  const [claims, total] = await Promise.all([
    ExpenseClaimModel.find(filter).sort({ submittedAt: dir, _id: dir }).skip(skip).limit(limit),
    ExpenseClaimModel.countDocuments(filter),
  ]);
  const [names, overLimit] = await Promise.all([
    namesFor(claims.flatMap((c) => [c.employeeId, c.decidedBy, c.paidBy])),
    overLimitCounts(claims.map((c) => c._id as Types.ObjectId)),
  ]);
  res.status(200).json(
    successResponse(
      claims.map((c) => ({ ...claimView(c, names), overLimitCount: overLimit.get(String(c._id)) ?? 0 })),
      { page, limit, total }
    )
  );
});

/** For the Approvals badge. */
export const pendingCount = asyncHandler(async (req: Request, res: Response) => {
  const count = await ExpenseClaimModel.countDocuments({ organizationId: req.orgFilter!.organizationId, status: 'submitted', isDeleted: false });
  res.status(200).json(successResponse({ count }));
});

/** Spending by category and department for an expense-date range (default: this month). */
export const summary = asyncHandler(async (req: Request, res: Response) => {
  const { from, to } = defaultRange(todayIso(), parse(rangeQuerySchema, req.query));
  if (from > to) throw new ApiError(400, "The end date can't be before the start date");
  res.status(200).json(successResponse(await expenseSummary(req.orgFilter!.organizationId, from, to)));
});
