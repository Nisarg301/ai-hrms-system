import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { authorize } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { getDashboardSummary } from '../controllers/dashboard.controller';

const router = Router();

// Authenticated + org-scoped, gated on 'dashboard' read. ORG_ADMIN passes
// automatically; ORG_USER is checked against its role matrix; SUPER_ADMIN is
// blocked from org modules. Per-module visibility within the response is
// decided inside the controller, not here.
router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/', authorize('dashboard', 'read'), getDashboardSummary);

export default router;
