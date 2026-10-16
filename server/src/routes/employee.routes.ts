import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { authorize, requireOrgAdmin } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { createEmployeeSchema, updateEmployeeSchema } from '../validators/employee.validators';
import * as employeeController from '../controllers/employee.controller';

const router = Router();

// Read stays gated by the 'employees' permission, same as every other module.
// Write actions require ORG_ADMIN outright -- creating/editing an employee
// also creates/changes a login account and its role, so a granted 'employees'
// permission alone must never be enough to mint an account or assign a role.
router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/', authorize('employees', 'read'), employeeController.listEmployees);
router.get('/:id', authorize('employees', 'read'), validateObjectId(), employeeController.getEmployee);
router.post('/', requireOrgAdmin, validate(createEmployeeSchema), employeeController.createEmployee);
router.put('/:id', requireOrgAdmin, validateObjectId(), validate(updateEmployeeSchema), employeeController.updateEmployee);
router.delete('/:id', requireOrgAdmin, validateObjectId(), employeeController.deleteEmployee);

export default router;
