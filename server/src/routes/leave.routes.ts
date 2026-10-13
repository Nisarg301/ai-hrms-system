import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { requireOrgAdmin } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { applyLeaveSchema, decideLeaveSchema, recordLeaveSchema } from '../validators/leave.validators';
import * as leaveController from '../controllers/leave.controller';

const router = Router();

router.use(authenticate, scopeToOrganization, requireActivePlan);

// Any member, for their own leave. (Balances and preview also take ?employeeId= for an ORG_ADMIN.)
router.get('/balances', leaveController.myBalances);
router.get('/preview', leaveController.previewLeave);
router.get('/requests/mine', leaveController.myRequests);
router.post('/requests', validate(applyLeaveSchema), leaveController.applyLeave);
router.post('/requests/:id/cancel', validateObjectId(), leaveController.cancelMyLeave);

// ORG_ADMIN decides everyone's leave.
router.get('/requests', requireOrgAdmin, leaveController.listLeaveRequests);
router.get('/pending-count', requireOrgAdmin, leaveController.pendingCount);
router.post('/requests/record', requireOrgAdmin, validate(recordLeaveSchema), leaveController.recordLeaveRequest);
router.post('/requests/:id/approve', requireOrgAdmin, validateObjectId(), validate(decideLeaveSchema), leaveController.approveLeaveRequest);
router.post('/requests/:id/reject', requireOrgAdmin, validateObjectId(), validate(decideLeaveSchema), leaveController.rejectLeaveRequest);

export default router;
