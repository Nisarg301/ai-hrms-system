import { QueryFilter } from 'mongoose';
import { userRepository } from '../repositories/user.repository';
import { comparePassword, hashPassword, generateRawToken, hashToken } from '../utils/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../auth/jwt';
import { ApiError } from '../utils/apiResponse';
import { IUser } from '../models/user.model';
import { organizationRepository } from '../repositories/organization.repository';
import { isPlanActive, ORG_PLAN_EXPIRED_MESSAGE } from './subscription.service';

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

function toTokenPayload(user: IUser) {
  return {
    userId: user._id.toString(),
    organizationId: user.organizationId ? user.organizationId.toString() : null,
    role: user.role,
    roleId: user.roleId ? user.roleId.toString() : null,
  };
}

async function issueTokens(user: IUser): Promise<AuthTokens> {
  const accessToken = signAccessToken(toTokenPayload(user));
  const refreshToken = signRefreshToken({ userId: user._id.toString() });
  user.refreshTokenHash = hashToken(refreshToken);
  await user.save();
  return { accessToken, refreshToken };
}

export const authService = {
  async login(email: string, password: string): Promise<{ user: IUser; tokens: AuthTokens }> {
    const user = await userRepository.findByEmail(email);
    if (!user || user.status === 'disabled') {
      throw new ApiError(401, 'Invalid email or password');
    }
    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      throw new ApiError(401, 'Invalid email or password');
    }
    // Only after the password is proven, so this can't be used to probe which
    // accounts exist. ORG_ADMIN always gets in: they're the one who has to pay.
    if (user.role === 'ORG_USER') {
      const org = user.organizationId ? await organizationRepository.findById(user.organizationId) : null;
      if (!org || !isPlanActive(org)) {
        throw new ApiError(403, ORG_PLAN_EXPIRED_MESSAGE, { code: 'ORG_PLAN_EXPIRED' });
      }
    }
    const tokens = await issueTokens(user);
    return { user, tokens };
  },

  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    let payload;
    try {
      payload = verifyRefreshToken(rawRefreshToken);
    } catch {
      throw new ApiError(401, 'Invalid or expired refresh token');
    }
    const user = await userRepository.findById(payload.userId);
    if (!user || !user.refreshTokenHash || user.refreshTokenHash !== hashToken(rawRefreshToken)) {
      throw new ApiError(401, 'Refresh token is no longer valid');
    }
    return issueTokens(user);
  },

  async logout(userId: string): Promise<void> {
    const user = await userRepository.findById(userId);
    if (!user) {
      return;
    }
    user.refreshTokenHash = null;
    await user.save();
  },

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new ApiError(404, 'User not found');
    }
    const valid = await comparePassword(oldPassword, user.passwordHash);
    if (!valid) {
      throw new ApiError(400, 'Current password is incorrect');
    }
    user.passwordHash = await hashPassword(newPassword);
    user.mustChangePassword = false;
    await user.save();
  },

  async forgotPassword(email: string): Promise<{ resetToken: string } | null> {
    const user = await userRepository.findByEmail(email);
    if (!user) {
      return null;
    }
    const rawToken = generateRawToken();
    user.resetPasswordTokenHash = hashToken(rawToken);
    user.resetPasswordExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();
    return { resetToken: rawToken };
  },

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const user = await userRepository.findOne({ resetPasswordTokenHash: tokenHash } as QueryFilter<IUser>);
    if (!user || !user.resetPasswordExpiresAt || user.resetPasswordExpiresAt.getTime() < Date.now()) {
      throw new ApiError(400, 'Reset token is invalid or expired');
    }
    user.passwordHash = await hashPassword(newPassword);
    user.resetPasswordTokenHash = null;
    user.resetPasswordExpiresAt = null;
    user.mustChangePassword = false;
    await user.save();
  },
};
