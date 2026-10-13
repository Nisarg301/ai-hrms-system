import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { requireOrgAdmin } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { createAnnouncementSchema, updateAnnouncementSchema } from '../validators/announcement.validators';
import * as announcementController from '../controllers/announcement.controller';

const router = Router();

// Every member reads announcements; only ORG_ADMIN publishes, edits or removes them.
router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/', announcementController.listAnnouncements);
router.post('/', requireOrgAdmin, validate(createAnnouncementSchema), announcementController.createAnnouncement);
router.put('/:id', requireOrgAdmin, validateObjectId(), validate(updateAnnouncementSchema), announcementController.updateAnnouncement);
router.delete('/:id', requireOrgAdmin, validateObjectId(), announcementController.deleteAnnouncement);

export default router;
