import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { authorize, requireOrgAdmin } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { requirePlanFeature } from '../middlewares/requirePlanFeature';
import * as exportController from '../controllers/export.controller';

const router = Router();

// Professional only: authorize() rejects 'exports' when the plan doesn't include it.
router.use(authenticate, scopeToOrganization, requireActivePlan);
// Attendance is everyone's data, so only an ORG_ADMIN exports it (still Professional only).
router.get('/attendance', authorize('exports', 'read'), requireOrgAdmin, exportController.exportAttendance);
router.get('/expenses', authorize('exports', 'read'), requireOrgAdmin, exportController.exportExpenses);
router.get('/reviews', authorize('exports', 'read'), requireOrgAdmin, requirePlanFeature('performance'), exportController.exportReviews);
router.get('/:module', authorize('exports', 'read'), exportController.exportModule);

export default router;
