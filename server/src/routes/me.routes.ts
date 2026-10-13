import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { validate } from '../middlewares/validate';
import { updateIntroductionSchema, updateMyDetailsSchema } from '../validators/introduction.validators';
import * as meController from '../controllers/me.controller';

const router = Router();

// The signed-in member's own things. Available to every org member.
router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/team', meController.getMyTeam);
router.get('/introduction', meController.getMyIntroduction);
router.put('/introduction', validate(updateIntroductionSchema), meController.updateMyIntroduction);
router.get('/profile-details', meController.getMyDetails);
router.put('/profile-details', validate(updateMyDetailsSchema), meController.updateMyDetails);

export default router;
