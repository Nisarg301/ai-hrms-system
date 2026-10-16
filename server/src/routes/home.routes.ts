import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { getHomeSummary } from '../controllers/home.controller';

const router = Router();

// Every active org member has Home, whatever their role's permission matrix.
router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/summary', getHomeSummary);

export default router;
