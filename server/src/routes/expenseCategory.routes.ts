import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { requireOrgAdmin } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { requirePlanFeature } from '../middlewares/requirePlanFeature';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { createCategorySchema, updateCategorySchema } from '../validators/expense.validators';
import * as categoryController from '../controllers/expenseCategory.controller';

const router = Router();

// Every member reads the categories (to file expenses); ORG_ADMIN manages them.
router.use(authenticate, scopeToOrganization, requireActivePlan, requirePlanFeature('expenses'));
router.get('/', categoryController.listCategories);
router.post('/', requireOrgAdmin, validate(createCategorySchema), categoryController.createCategory);
router.put('/:id', requireOrgAdmin, validateObjectId(), validate(updateCategorySchema), categoryController.updateCategory);
router.delete('/:id', requireOrgAdmin, validateObjectId(), categoryController.deleteCategory);

export default router;
