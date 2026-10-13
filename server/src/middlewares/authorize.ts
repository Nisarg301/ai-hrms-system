import { Response, NextFunction, Request } from 'express';
import { asyncHandler } from './asyncHandler';
import { ApiError } from '../utils/apiResponse';
import { ModuleName } from '../constants/modules';
import { PermissionAction, hasPermission } from '../permissions/checkPermission';
import { roleRepository } from '../repositories/role.repository';

export function authorize(module: ModuleName, action: PermissionAction) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new ApiError(401, 'Authentication required');
    }
    if (req.user.role === 'SUPER_ADMIN') {
      throw new ApiError(403, 'Super Admin cannot access organization modules');
    }
    // The plan applies to ORG_ADMIN too: a Basic org has no Exports or Audit Logs at all.
    // req.subscription is set by requireActivePlan, which every org router mounts.
    if (req.subscription && !req.subscription.modules.includes(module)) {
      throw new ApiError(403, 'Module not included in your plan', { code: 'MODULE_NOT_IN_PLAN' });
    }
    if (req.user.role === 'ORG_ADMIN') {
      next();
      return;
    }
    const role = req.user.roleId ? await roleRepository.findById(req.user.roleId) : null;
    if (!hasPermission(req.user, role, module, action)) {
      throw new ApiError(403, `Missing '${action}' permission on '${module}'`);
    }
    next();
  });
}

export const requireSuperAdmin = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== 'SUPER_ADMIN') {
    throw new ApiError(403, 'Super Admin access required');
  }
  next();
});

export const requireOrgAdmin = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== 'ORG_ADMIN') {
    throw new ApiError(403, 'Organization Admin access required');
  }
  next();
});
