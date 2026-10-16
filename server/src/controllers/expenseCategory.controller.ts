import { Request, Response } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { ExpenseCategoryModel, IExpenseCategory } from '../models/expenseCategory.model';
import { ExpenseItemModel } from '../models/expenseItem.model';
import { auditCrud } from '../services/audit.service';
import { ensureDefaultCategories, fieldError } from '../services/expense.service';
import { successResponse, ApiError } from '../utils/apiResponse';

function serialize(c: IExpenseCategory) {
  return {
    id: String(c._id),
    name: c.name,
    limitPaise: c.limitPaise,
    receiptRequiredAbovePaise: c.receiptRequiredAbovePaise,
    isActive: c.isActive,
  };
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number }).code === 11000;
}

const nameTaken = () => fieldError('name', 'There is already a category with this name');

/** Active categories for everyone; `?all=true` gives an ORG_ADMIN the inactive ones too. */
export const listCategories = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  await ensureDefaultCategories(organizationId);
  const includeInactive = req.query.all === 'true' && req.user!.role === 'ORG_ADMIN';
  const categories = await ExpenseCategoryModel.find({ organizationId, isDeleted: false, ...(includeInactive ? {} : { isActive: true }) }).sort({
    nameKey: 1,
  });
  res.status(200).json(successResponse(categories.map(serialize)));
});

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  await ensureDefaultCategories(organizationId);
  try {
    const category = await ExpenseCategoryModel.create({
      organizationId,
      ...req.body,
      nameKey: req.body.name.toLowerCase(),
      createdBy: req.user!.id,
      updatedBy: req.user!.id,
    });
    await auditCrud(req, 'create', 'expenses', { id: String(category._id), label: `Category ${category.name}` });
    res.status(201).json(successResponse(serialize(category)));
  } catch (err) {
    if (isDuplicateKey(err)) throw nameTaken();
    throw err;
  }
});

export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const set: Record<string, unknown> = { ...req.body, updatedBy: req.user!.id };
  if (req.body.name) set.nameKey = req.body.name.toLowerCase();
  try {
    const updated = await ExpenseCategoryModel.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.orgFilter!.organizationId, isDeleted: false },
      { $set: set },
      { returnDocument: 'after' }
    );
    if (!updated) throw new ApiError(404, 'Category not found');
    await auditCrud(req, 'update', 'expenses', { id: req.params.id, label: `Category ${updated.name}` });
    res.status(200).json(successResponse(serialize(updated)));
  } catch (err) {
    if (isDuplicateKey(err)) throw nameTaken();
    throw err;
  }
});

/** Refused once any expense uses it (past claims must keep their category); deactivate it instead. */
export const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.orgFilter!.organizationId;
  const category = await ExpenseCategoryModel.findOne({ _id: req.params.id, organizationId, isDeleted: false });
  if (!category) throw new ApiError(404, 'Category not found');
  if (await ExpenseItemModel.exists({ organizationId, categoryId: category._id, isDeleted: false })) {
    throw new ApiError(400, 'This category is used by expenses. Deactivate it instead.');
  }
  await ExpenseCategoryModel.updateOne({ _id: category._id }, { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: req.user!.id } });
  await auditCrud(req, 'delete', 'expenses', { id: req.params.id, label: `Category ${category.name}` });
  res.status(200).json(successResponse({ id: req.params.id, deleted: true }));
});
