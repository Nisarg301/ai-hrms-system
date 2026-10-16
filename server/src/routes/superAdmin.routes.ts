import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { requireSuperAdmin } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { inviteOrgAdminSchema } from '../validators/invite.validators';
import * as superAdminController from '../controllers/superAdmin.controller';
import * as organizationController from '../controllers/organization.controller';

const router = Router();

router.use(authenticate, requireSuperAdmin);
router.post('/invite-org-admin', validate(inviteOrgAdminSchema), superAdminController.inviteOrgAdmin);
router.get('/admin-users', superAdminController.listAdminUsers);
router.patch('/admin-users/:id/disable', validateObjectId(), superAdminController.disableAdminUser);
router.get('/organizations', organizationController.listOrganizations);

export default router;
