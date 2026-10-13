import { Response, NextFunction, Request } from 'express';
import { asyncHandler } from './asyncHandler';
import { verifyAccessToken } from '../auth/jwt';
import { userRepository } from '../repositories/user.repository';
import { ApiError } from '../utils/apiResponse';

export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new ApiError(401, 'Missing or malformed Authorization header');
  }

  const token = header.slice('Bearer '.length);
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new ApiError(401, 'Invalid or expired token');
  }

  const user = await userRepository.findById(payload.userId);
  if (!user || user.status === 'disabled') {
    throw new ApiError(401, 'User not found or disabled');
  }

  req.user = {
    id: user._id.toString(),
    organizationId: user.organizationId ? user.organizationId.toString() : null,
    role: user.role,
    roleId: user.roleId ? user.roleId.toString() : null,
    name: user.name,
  };
  next();
});
