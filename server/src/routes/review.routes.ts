import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { requireOrgAdmin } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { requirePlanFeature } from '../middlewares/requirePlanFeature';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { reassignSchema, reopenSchema, reviewPartSchema } from '../validators/performance.validators';
import * as reviewController from '../controllers/review.controller';

const router = Router();

// Reviews: the person reviewed, their reviewer, and ORG_ADMINs (checked per review; others 404).
router.use(authenticate, scopeToOrganization, requireActivePlan, requirePlanFeature('performance'));
router.get('/mine', reviewController.myReviews);
router.get('/to-write', reviewController.reviewsToWrite);
router.get('/:id', validateObjectId(), reviewController.getReview);
router.put('/:id/self', validateObjectId(), validate(reviewPartSchema), reviewController.saveSelf);
router.post('/:id/self/submit', validateObjectId(), validate(reviewPartSchema), reviewController.submitSelf);
router.put('/:id/manager', validateObjectId(), validate(reviewPartSchema), reviewController.saveManager);
router.post('/:id/manager/submit', validateObjectId(), validate(reviewPartSchema), reviewController.submitManager);
router.post('/:id/reopen', requireOrgAdmin, validateObjectId(), validate(reopenSchema), reviewController.reopen);
router.post('/:id/reassign', requireOrgAdmin, validateObjectId(), validate(reassignSchema), reviewController.reassign);

export default router;
