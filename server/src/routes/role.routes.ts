import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { requireOrgAdmin } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { createRoleSchema, updateRoleSchema } from '../validators/role.validators';
import * as roleController from '../controllers/role.controller';

const router = Router();

router.use(authenticate, requireOrgAdmin, scopeToOrganization, requireActivePlan);
router.post('/', validate(createRoleSchema), roleController.createRole);
router.get('/', roleController.listRoles);
router.get('/:id', validateObjectId(), roleController.getRole);
router.put('/:id', validateObjectId(), validate(updateRoleSchema), roleController.updateRole);
router.delete('/:id', validateObjectId(), roleController.deleteRole);

export default router;
