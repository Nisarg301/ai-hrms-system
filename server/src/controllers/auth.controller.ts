import { Request, Response } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { authService } from '../services/auth.service';
import { successResponse, ApiError } from '../utils/apiResponse';
import { env } from '../config/env';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../constants/auth';
import { userRepository } from '../repositories/user.repository';
import { IUser } from '../models/user.model';
import { resolveEffectivePermissions } from '../permissions/effectivePermissions';
import { subscriptionState } from '../services/subscription.service';
import { organizationRepository } from '../repositories/organization.repository';
import { auditService } from '../services/audit.service';
import { avatarUrl } from '../services/people.service';
import { deleteFile, getBucket, uploadFile } from '../services/gridfs.service';
import { Types } from 'mongoose';

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

// `permissions` is a snapshot taken at login/`me`-time. If a role is edited
// mid-session, the client's cached permissions (nav, button gating) stay stale
// until the next /me, while backend authorize() re-reads the role fresh on every
// request. By design: the client permission model is UX only; the server is the
// authority.
async function buildAuthUserPayload(user: IUser) {
  const org = user.organizationId ? await organizationRepository.findById(user.organizationId) : null;
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId ? user.organizationId.toString() : null,
    // Shown in the app header; null for SUPER_ADMIN.
    organizationName: org?.name ?? null,
    roleId: user.roleId ? user.roleId.toString() : null,
    mustChangePassword: user.mustChangePassword,
    permissions: await resolveEffectivePermissions(user),
    // null for accounts without an org (SUPER_ADMIN), which are never plan-gated.
    subscription: org ? subscriptionState(org) : null,
    avatar: user.avatar?.id
      ? {
        id: user.avatar.id.toString(),
        originalName: user.avatar.originalName || '',
        mimeType: user.avatar.mimeType || '',
        size: user.avatar.size || 0,
        url: avatarUrl(user)!,
      }
      : null,
  };
}

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const { user, tokens } = await authService.login(email, password);
  // Successful logins only; failed or refused attempts never reach this line.
  if (user.organizationId) {
    await auditService.record({
      organizationId: user.organizationId,
      actor: { id: user._id.toString(), name: user.name, role: user.role },
      action: 'login',
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
  }
  setRefreshCookie(res, tokens.refreshToken);
  res.status(200).json(
    successResponse({
      accessToken: tokens.accessToken,
      user: await buildAuthUserPayload(user),
    })
  );
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!rawToken) {
    throw new ApiError(401, 'Missing refresh token');
  }
  const tokens = await authService.refresh(rawToken);
  setRefreshCookie(res, tokens.refreshToken);
  res.status(200).json(successResponse({ accessToken: tokens.accessToken }));
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  if (req.user) {
    if (req.user.organizationId) {
      await auditService.record({
        organizationId: req.user.organizationId,
        actor: { id: req.user.id, name: req.user.name ?? '', role: req.user.role },
        action: 'logout',
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
    }
    await authService.logout(req.user.id);
  }
  clearRefreshCookie(res);
  res.status(200).json(successResponse({ loggedOut: true }));
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(401, 'Authentication required');
  }
  const user = await userRepository.findById(req.user.id);
  if (!user) {
    throw new ApiError(401, 'User not found');
  }
  res.status(200).json(successResponse({ user: await buildAuthUserPayload(user) }));
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(401, 'Authentication required');
  }
  await authService.changePassword(req.user.id, req.body.oldPassword, req.body.newPassword);
  res.status(200).json(successResponse({ changed: true }));
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.forgotPassword(req.body.email);
  res.status(200).json(successResponse({ resetToken: result?.resetToken ?? null }));
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.resetPassword(req.body.token, req.body.newPassword);
  res.status(200).json(successResponse({ reset: true }));
});


export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(401, 'Authentication required');
  }

  const existing = await userRepository.findById(req.user.id);

  if (!existing) {
    throw new ApiError(404, 'User not found');
  }

  if (req.body.name) {
    existing.name = req.body.name.trim();
  }

  let oldFileId: Types.ObjectId | null = null;

  if (req.file) {
    const newFileId = await uploadFile({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    oldFileId = existing.avatar?.id ?? null;

    existing.avatar = {
      id: newFileId,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    };
    existing.markModified('avatar');
  }

  const user = await existing.save();

  if (oldFileId) {
    try {
      await deleteFile(oldFileId);
    } catch (error) {
      console.error(
        'Failed to delete previous avatar from GridFS:',
        error
      );
    }
  }
  res.status(200).json(successResponse({ user: await buildAuthUserPayload(user) }));
});


export const getAvatar = asyncHandler(async (req: Request, res: Response) => {
  let userId = req.params.userId || (req.query.userId as string);

  if (!userId && req.user?.id) {
    userId = req.user.id;
  }

  if (!userId || !Types.ObjectId.isValid(userId)) {
    throw new ApiError(404, 'Avatar not found');
  }

  const user = await userRepository.findById(userId);
  if (!user || !user.avatar?.id) {
    throw new ApiError(404, 'Avatar not found');
  }
  const bucket = getBucket();

  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader(
    'Content-Type',
    user.avatar.mimeType || 'application/octet-stream'
  );

  res.setHeader(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(user.avatar.originalName || 'avatar')}"`
  );
  res.setHeader('Cache-Control', 'public, max-age=86400');

  const downloadStream = bucket.openDownloadStream(user.avatar.id);
  downloadStream.on('error', () => {
    if (!res.headersSent) {
      res.status(404).json({ message: 'Avatar file not found' });
    } else {
      res.end();
    }
  });
  downloadStream.pipe(res);
});