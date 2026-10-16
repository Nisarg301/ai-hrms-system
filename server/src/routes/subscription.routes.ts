import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { requireOrgAdmin } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { validate } from '../middlewares/validate';
import { createOrderSchema, verifyPaymentSchema } from '../validators/subscription.validators';
import * as subscriptionController from '../controllers/subscription.controller';

const router = Router();

// ORG_ADMIN only, and deliberately never behind the active-plan check: paying
// here is how an organization without a plan gets unblocked.
router.use(authenticate, requireOrgAdmin, scopeToOrganization);
router.get('/', subscriptionController.getSubscription);
router.post('/orders', validate(createOrderSchema), subscriptionController.createOrder);
router.post('/verify', validate(verifyPaymentSchema), subscriptionController.verifyPayment);

export default router;
