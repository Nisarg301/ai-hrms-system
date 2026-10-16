import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { requireOrgAdmin } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { requirePlanFeature } from '../middlewares/requirePlanFeature';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { createCycleSchema, updateCycleSchema } from '../validators/performance.validators';
import * as cycleController from '../controllers/reviewCycle.controller';

const router = Router();

// ORG_ADMIN runs review cycles (Professional, P1).
router.use(authenticate, scopeToOrganization, requireActivePlan, requirePlanFeature('performance'), requireOrgAdmin);
router.get('/', cycleController.listCycles);
router.post('/', validate(createCycleSchema), cycleController.createCycle);
router.get('/:id', validateObjectId(), cycleController.getCycle);
router.put('/:id', validateObjectId(), validate(updateCycleSchema), cycleController.updateCycle);
router.delete('/:id', validateObjectId(), cycleController.deleteCycle);
router.post('/:id/launch', validateObjectId(), cycleController.launchCycle);
router.post('/:id/release', validateObjectId(), cycleController.releaseCycle);
router.post('/:id/close', validateObjectId(), cycleController.closeCycle);
router.get('/:id/reviews', validateObjectId(), cycleController.cycleReviews);
router.get('/:id/summary', validateObjectId(), cycleController.cycleSummary);

export default router;
