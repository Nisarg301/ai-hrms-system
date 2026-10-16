import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { requireOrgAdmin } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { requirePlanFeature } from '../middlewares/requirePlanFeature';
import { taskFileUpload } from '../middlewares/upload';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import {
  adHocTaskSchema,
  cancelProcessSchema,
  completeProcessSchema,
  completeTaskSchema,
  skipTaskSchema,
  startOffboardingSchema,
  startOnboardingSchema,
  updateTaskSchema,
} from '../validators/lifecycle.validators';
import * as lifecycleController from '../controllers/lifecycle.controller';

const router = Router();

// Onboarding and offboarding: both plans (O1). ORG_ADMIN runs processes; everyone does their own tasks.
router.use(authenticate, scopeToOrganization, requireActivePlan, requirePlanFeature('onboarding'));

// My side: my own process, tasks assigned to me, completing them (and their files).
router.get('/mine', lifecycleController.mine);
router.get('/tasks/assigned-to-me', lifecycleController.assignedToMe);
router.post('/tasks/:taskId/complete', validateObjectId('taskId'), validate(completeTaskSchema), lifecycleController.completeMyTask);
router.post('/tasks/:taskId/files', validateObjectId('taskId'), taskFileUpload.single('file'), lifecycleController.addFile);
router.get('/tasks/:taskId/files/:fileId', validateObjectId('taskId'), validateObjectId('fileId'), lifecycleController.getFile);
router.delete('/tasks/:taskId/files/:fileId', validateObjectId('taskId'), validateObjectId('fileId'), lifecycleController.deleteTaskFile);

// ORG_ADMIN: tasks.
router.put('/tasks/:taskId', requireOrgAdmin, validateObjectId('taskId'), validate(updateTaskSchema), lifecycleController.updateTask);
router.post('/tasks/:taskId/skip', requireOrgAdmin, validateObjectId('taskId'), validate(skipTaskSchema), lifecycleController.skipTask);

// ORG_ADMIN: processes.
router.get('/candidates', requireOrgAdmin, lifecycleController.candidates);
router.post('/onboarding', requireOrgAdmin, validate(startOnboardingSchema), lifecycleController.startOnboarding);
router.post('/offboarding', requireOrgAdmin, validate(startOffboardingSchema), lifecycleController.startOffboarding);
router.get('/', requireOrgAdmin, lifecycleController.listProcesses);
router.get('/:id', requireOrgAdmin, validateObjectId(), lifecycleController.getProcess);
router.post('/:id/tasks', requireOrgAdmin, validateObjectId(), validate(adHocTaskSchema), lifecycleController.addTask);
router.post('/:id/complete', requireOrgAdmin, validateObjectId(), validate(completeProcessSchema), lifecycleController.complete);
router.post('/:id/cancel', requireOrgAdmin, validateObjectId(), validate(cancelProcessSchema), lifecycleController.cancel);

export default router;
