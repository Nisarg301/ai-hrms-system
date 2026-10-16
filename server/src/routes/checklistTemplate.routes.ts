import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { requireOrgAdmin } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { requirePlanFeature } from '../middlewares/requirePlanFeature';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { createTemplateSchema, updateTemplateSchema } from '../validators/lifecycle.validators';
import * as templateController from '../controllers/checklistTemplate.controller';

const router = Router();

// Onboarding and offboarding checklists: both plans (O1), ORG_ADMIN only.
router.use(authenticate, scopeToOrganization, requireActivePlan, requirePlanFeature('onboarding'), requireOrgAdmin);
router.get('/', templateController.listTemplates);
router.post('/', validate(createTemplateSchema), templateController.createTemplate);
router.get('/:id', validateObjectId(), templateController.getTemplate);
router.put('/:id', validateObjectId(), validate(updateTemplateSchema), templateController.updateTemplate);
router.delete('/:id', validateObjectId(), templateController.deleteTemplate);
router.post('/:id/make-default', validateObjectId(), templateController.makeDefault);

export default router;
