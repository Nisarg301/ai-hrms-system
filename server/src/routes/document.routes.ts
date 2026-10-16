import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { authorize } from '../middlewares/authorize';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { upload } from '../middlewares/upload';
import { createDocumentSchema, updateDocumentSchema } from '../validators/document.validators';
import * as documentController from '../controllers/document.controller';

const router = Router();

// Every route: authenticated + org-scoped; each action gated by the matching
// module permission. ORG_ADMIN passes authorize automatically; ORG_USER is
// checked against its role matrix; SUPER_ADMIN is blocked from org modules.
router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/', authorize('documents', 'read'), documentController.listDocuments);
router.get('/:id', authorize('documents', 'read'), validateObjectId(), documentController.getDocument);
router.get('/:id/file', authorize('documents', 'read'), validateObjectId(), documentController.downloadDocumentFile);
router.post('/', authorize('documents', 'create'), upload.single('file'), validate(createDocumentSchema), documentController.createDocument);
router.put('/:id', authorize('documents', 'update'), validateObjectId(), upload.single('file'), validate(updateDocumentSchema), documentController.updateDocument);
router.delete('/:id', authorize('documents', 'delete'), validateObjectId(), documentController.deleteDocument);

export default router;
