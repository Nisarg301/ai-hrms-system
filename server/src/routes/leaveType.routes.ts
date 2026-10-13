import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { requireOrgAdmin } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { createLeaveTypeSchema, updateLeaveTypeSchema } from '../validators/leave.validators';
import * as leaveTypeController from '../controllers/leaveType.controller';

const router = Router();

// Every member sees the leave types they can apply for; only ORG_ADMIN manages them.
router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/', leaveTypeController.listLeaveTypes);
router.post('/', requireOrgAdmin, validate(createLeaveTypeSchema), leaveTypeController.createLeaveType);
router.put('/:id', requireOrgAdmin, validateObjectId(), validate(updateLeaveTypeSchema), leaveTypeController.updateLeaveType);
router.delete('/:id', requireOrgAdmin, validateObjectId(), leaveTypeController.deleteLeaveType);

export default router;
