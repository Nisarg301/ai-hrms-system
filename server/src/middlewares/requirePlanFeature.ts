import { Request, Response, NextFunction } from 'express';
import { PlanFeature } from '../constants/modules';
import { ApiError } from '../utils/apiResponse';

/**
 * Mount after requireActivePlan (which sets req.subscription): refuses a feature the
 * organization's plan doesn't include, with a code the client can show an upgrade for.
 */
export function requirePlanFeature(feature: PlanFeature) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.subscription && !req.subscription.features.includes(feature)) {
      next(new ApiError(403, 'This feature is not included in your plan', { code: 'FEATURE_NOT_IN_PLAN', feature }));
      return;
    }
    next();
  };
}
