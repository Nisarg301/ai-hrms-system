import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { requirePlanFeature } from '../middlewares/requirePlanFeature';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { checkInSchema, createGoalSchema, updateGoalSchema } from '../validators/performance.validators';
import * as goalController from '../controllers/goal.controller';

const router = Router();

// Performance is Professional (P1). Access is by relationship (owner, direct manager,
// ORG_ADMIN), checked per goal in the controller; anyone else gets 404.
router.use(authenticate, scopeToOrganization, requireActivePlan, requirePlanFeature('performance'));
router.get('/mine', goalController.myGoals);
router.get('/team', goalController.teamGoals);
router.post('/', validate(createGoalSchema), goalController.createGoal);
router.get('/:id', validateObjectId(), goalController.getGoal);
router.put('/:id', validateObjectId(), validate(updateGoalSchema), goalController.updateGoal);
router.delete('/:id', validateObjectId(), goalController.deleteGoal);
router.post('/:id/check-ins', validateObjectId(), validate(checkInSchema), goalController.checkIn);

export default router;
