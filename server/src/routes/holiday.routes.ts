import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { requireOrgAdmin } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { createHolidaySchema, updateHolidaySchema } from '../validators/holiday.validators';
import * as holidayController from '../controllers/holiday.controller';

const router = Router();

// Every member can read the holiday calendar; only ORG_ADMIN changes it.
router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/', holidayController.listHolidays);
router.post('/', requireOrgAdmin, validate(createHolidaySchema), holidayController.createHoliday);
router.put('/:id', requireOrgAdmin, validateObjectId(), validate(updateHolidaySchema), holidayController.updateHoliday);
router.delete('/:id', requireOrgAdmin, validateObjectId(), holidayController.deleteHoliday);

export default router;
