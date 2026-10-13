import { Request, Response } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { PLAN_TYPES } from '../constants/modules';
import { PLANS, PLAN_CURRENCY } from '../constants/plans';
import { successResponse } from '../utils/apiResponse';

export const listPlans = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200).json(
    successResponse(PLAN_TYPES.map((type) => ({ ...PLANS[type], modules: [...PLANS[type].modules], currency: PLAN_CURRENCY })))
  );
});
