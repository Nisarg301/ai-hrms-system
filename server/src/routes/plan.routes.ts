import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import * as planController from '../controllers/plan.controller';

const router = Router();

// Any signed-in user, including an ORG_ADMIN whose plan has expired: they need it to pay.
router.get('/', authenticate, planController.listPlans);

export default router;
