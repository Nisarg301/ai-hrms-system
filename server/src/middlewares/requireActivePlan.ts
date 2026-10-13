import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from './asyncHandler';
import { ApiError } from '../utils/apiResponse';
import { organizationRepository } from '../repositories/organization.repository';
import { markExpiredIfNeeded, subscriptionState, SubscriptionState } from '../services/subscription.service';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireActivePlan; read by authorize() to enforce plan modules. */
      subscription?: SubscriptionState;
    }
  }
}

/**
 * Mount after authenticate + scopeToOrganization on every org-module router.
 * 402 plus a machine-readable code tells the client which screen to show:
 * PLAN_REQUIRED (never bought) or PLAN_EXPIRED.
 */
export const requireActivePlan = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) {
    throw new ApiError(401, 'Authentication required');
  }
  if (req.user.role === 'SUPER_ADMIN') {
    next();
    return;
  }
  const org = await organizationRepository.findById(req.orgFilter!.organizationId);
  if (!org) {
    throw new ApiError(403, 'Organization not found');
  }
  const state = subscriptionState(org);
  if (!state.active) {
    await markExpiredIfNeeded(org);
    throw org.planType
      ? new ApiError(402, 'Your organization plan has expired', { code: 'PLAN_EXPIRED' })
      : new ApiError(402, 'Your organization has no active plan', { code: 'PLAN_REQUIRED' });
  }
  req.subscription = state;
  next();
});
