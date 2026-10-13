import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { authorize } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import * as auditLogController from '../controllers/auditLog.controller';

const router = Router();

// Professional only: authorize() rejects 'auditLogs' when the plan doesn't include it.
router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/', authorize('auditLogs', 'read'), auditLogController.listAuditLogs);

export default router;
