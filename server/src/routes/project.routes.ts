import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { authorize } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { createProjectSchema, updateProjectSchema } from '../validators/project.validators';
import * as projectController from '../controllers/project.controller';

const router = Router();

// Every route: authenticated + org-scoped; each action gated by the matching
// module permission. ORG_ADMIN passes authorize automatically; ORG_USER is
// checked against its role matrix; SUPER_ADMIN is blocked from org modules.
router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/', authorize('projects', 'read'), projectController.listProjects);
router.get('/:id', authorize('projects', 'read'), validateObjectId(), projectController.getProject);
router.post('/', authorize('projects', 'create'), validate(createProjectSchema), projectController.createProject);
router.put('/:id', authorize('projects', 'update'), validateObjectId(), validate(updateProjectSchema), projectController.updateProject);
router.delete('/:id', authorize('projects', 'delete'), validateObjectId(), projectController.deleteProject);

export default router;
