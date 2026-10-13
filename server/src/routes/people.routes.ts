import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { validateObjectId } from '../middlewares/validateObjectId';
import * as peopleController from '../controllers/people.controller';

const router = Router();

// Every org member, whatever their role: this is the colleague directory, not the
// Employees admin module.
router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/', peopleController.listPeople);
router.get('/introductions', peopleController.listIntroductions);
router.get('/search', peopleController.searchPeople);
// After the fixed paths, so /search and /introductions aren't read as ids.
router.get('/:id', validateObjectId(), peopleController.getPersonProfile);

export default router;
