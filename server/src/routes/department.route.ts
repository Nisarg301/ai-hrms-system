import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { authorize, requireOrgAdmin } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { createDepartmentSchema, updateDepartmentSchema } from '../validators/department.validators';
import * as departmentController from '../controllers/department.controller';

const router = Router();

router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/', authorize('departments', 'read'), departmentController.listDepartments);
router.get('/:id', authorize('departments', 'read'), validateObjectId(), departmentController.getDepartment);
router.post('/', requireOrgAdmin, validate(createDepartmentSchema), departmentController.createDepartment);
router.put('/:id', requireOrgAdmin, validateObjectId(), validate(updateDepartmentSchema), departmentController.updateDepartment);
router.delete('/:id', requireOrgAdmin, validateObjectId(), departmentController.deleteDepartment);

export default router;
