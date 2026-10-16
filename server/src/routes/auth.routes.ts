import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { validate } from '../middlewares/validate';
import { authenticate } from '../middlewares/authenticate';
import { authRateLimiter } from '../middlewares/rateLimiter';
import { loginSchema, changePasswordSchema, forgotPasswordSchema, resetPasswordSchema, updateProfileSchema } from '../validators/auth.validators';
import { avatarUpload } from '../middlewares/upload';

const router = Router();

router.post('/login', authRateLimiter, validate(loginSchema), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);
router.post('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);
router.post('/forgot-password', authRateLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);
router.put('/update-profile', authenticate, avatarUpload.single('avatar'), validate(updateProfileSchema), authController.updateProfile);
// Public on purpose: <img> tags can't send the bearer token.
router.get('/avatar/:userId', authController.getAvatar);
router.get('/me/avatar', authenticate, authController.getAvatar);

export default router;
