import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { requirePlanFeature } from '../middlewares/requirePlanFeature';
import { aiRateLimiter } from '../middlewares/rateLimiter';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { upload } from '../middlewares/upload';
import { chatSchema, confirmSchema } from '../validators/ai.validators';
import * as aiController from '../controllers/ai.controller';

const router = Router();

// The assistant is a Professional-plan feature. Every tool then calls the existing API with
// the user's own token, so each module's own permission checks still apply.
router.use(authenticate, scopeToOrganization, requireActivePlan, requirePlanFeature('ai'));
router.get('/health', aiController.health);

router.use(aiController.requireAiEnabled);
router.get('/modules', aiController.listModules);
router.post('/chat', aiRateLimiter, validate(chatSchema), aiController.chat);
// A document upload confirms with its file: checked by the same middleware as the Documents page's uploads.
router.post('/actions/:id/confirm', aiRateLimiter, validateObjectId(), upload.single('file'), aiController.valuesFromMultipart, validate(confirmSchema), aiController.confirm);
router.post('/actions/:id/cancel', validateObjectId(), aiController.cancel);
router.get('/conversations', aiController.listConversations);
router.get('/conversations/:id', validateObjectId(), aiController.getConversation);
router.delete('/conversations/:id', validateObjectId(), aiController.deleteConversation);

export default router;
