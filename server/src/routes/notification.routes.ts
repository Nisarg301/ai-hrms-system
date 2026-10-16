import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { validateObjectId } from '../middlewares/validateObjectId';
import * as notificationController from '../controllers/notification.controller';

const router = Router();

// Every member's own bell.
router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/', notificationController.listNotifications);
router.get('/unread-count', notificationController.unreadCount);
router.post('/read-all', notificationController.markAllRead);
router.post('/:id/read', validateObjectId(), notificationController.markRead);

export default router;
