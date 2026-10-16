import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate';
import { scopeToOrganization } from '../middlewares/scopeToOrganization';
import { requireActivePlan } from '../middlewares/requireActivePlan';
import { validate } from '../middlewares/validate';
import { validateObjectId } from '../middlewares/validateObjectId';
import { createCommentSchema, createPostSchema } from '../validators/post.validators';
import * as postController from '../controllers/post.controller';

const router = Router();

// Every member posts, likes and comments. Deleting (author or ORG_ADMIN) is checked in the controller.
router.use(authenticate, scopeToOrganization, requireActivePlan);
router.get('/', postController.listPosts);
router.post('/', validate(createPostSchema), postController.createPost);
router.delete('/:id', validateObjectId(), postController.deletePost);
router.post('/:id/like', validateObjectId(), postController.toggleLike);
router.get('/:id/comments', validateObjectId(), postController.listComments);
router.post('/:id/comments', validateObjectId(), validate(createCommentSchema), postController.createComment);
router.delete('/:id/comments/:commentId', validateObjectId(), validateObjectId('commentId'), postController.deleteComment);

export default router;
