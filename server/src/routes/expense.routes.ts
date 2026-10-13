import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { requirePlanFeature } from '../middlewares/requirePlanFeature';
import { receiptUpload } from '../middlewares/upload';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { approveSchema, claimSchema, itemSchema, paySchema, rejectSchema, updateItemSchema } from '../validators/expense.validators';
import { requireOrgAdmin } from '../middlewares/authorize';
import * as expenseController from '../controllers/expense.controller';

const router = Router();

// Every member files their own claims (Basic and Professional, E1).
router.use(authenticate, scopeToOrganization, requireActivePlan, requirePlanFeature('expenses'));
router.get('/mine', expenseController.myClaims);
// ORG_ADMIN: everyone's claims (drafts excluded), the badge count, and the spending summary.
router.get('/', requireOrgAdmin, expenseController.listClaims);
router.get('/pending-count', requireOrgAdmin, expenseController.pendingCount);
router.get('/summary', requireOrgAdmin, expenseController.summary);
router.post('/', validate(claimSchema), expenseController.createClaim);
// ORG_ADMIN pays approved claims, one or many at a time.
router.post('/pay', requireOrgAdmin, validate(paySchema), expenseController.pay);
router.get('/:id', validateObjectId(), expenseController.getClaim);
router.put('/:id', validateObjectId(), validate(claimSchema), expenseController.renameClaim);
router.delete('/:id', validateObjectId(), expenseController.deleteClaim);

// The owner submits, withdraws (until decided) and copies; ORG_ADMIN decides.
router.post('/:id/submit', validateObjectId(), expenseController.submit);
router.post('/:id/withdraw', validateObjectId(), expenseController.withdraw);
router.post('/:id/copy', validateObjectId(), expenseController.copy);
router.post('/:id/approve', requireOrgAdmin, validateObjectId(), validate(approveSchema), expenseController.approve);
router.post('/:id/reject', requireOrgAdmin, validateObjectId(), validate(rejectSchema), expenseController.reject);

router.post('/:id/items', validateObjectId(), validate(itemSchema), expenseController.addItem);
router.put('/:id/items/:itemId', validateObjectId(), validateObjectId('itemId'), validate(updateItemSchema), expenseController.updateItem);
router.delete('/:id/items/:itemId', validateObjectId(), validateObjectId('itemId'), expenseController.deleteItem);

router.post('/:id/items/:itemId/receipts', validateObjectId(), validateObjectId('itemId'), receiptUpload.single('file'), expenseController.addReceipt);
router.get('/:id/items/:itemId/receipts/:fileId', validateObjectId(), validateObjectId('itemId'), validateObjectId('fileId'), expenseController.getReceipt);
router.delete('/:id/items/:itemId/receipts/:fileId', validateObjectId(), validateObjectId('itemId'), validateObjectId('fileId'), expenseController.deleteReceipt);

export default router;
