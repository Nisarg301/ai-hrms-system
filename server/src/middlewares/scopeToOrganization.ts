import { Response, NextFunction, Request } from 'express';
import { Types } from 'mongoose';
import { ApiError } from '../utils/apiResponse';

declare global {
  namespace Express {
    interface Request {
      orgFilter?: { organizationId: Types.ObjectId };
    }
  }
}

export function scopeToOrganization(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user || req.user.role === 'SUPER_ADMIN' || !req.user.organizationId) {
    throw new ApiError(403, 'Organization scope required');
  }
  req.orgFilter = { organizationId: new Types.ObjectId(req.user.organizationId) };
  next();
}
