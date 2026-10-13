import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { authorize } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { createTaskSchema, updateTaskSchema } from '../validators/task.validators';
import * as taskController from '../controllers/task.controller';

const router = Router();

// Every route: authenticated + org-scoped; each action gated by the matching
// module permission. ORG_ADMIN passes authorize automatically; ORG_USER is
// checked against its role matrix; SUPER_ADMIN is blocked from org modules.
router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/', authorize('tasks', 'read'), taskController.listTasks);
router.get('/:id', authorize('tasks', 'read'), validateObjectId(), taskController.getTask);
router.post('/', authorize('tasks', 'create'), validate(createTaskSchema), taskController.createTask);
router.put('/:id', authorize('tasks', 'update'), validateObjectId(), validate(updateTaskSchema), taskController.updateTask);
router.delete('/:id', authorize('tasks', 'delete'), validateObjectId(), taskController.deleteTask);

export default router;
