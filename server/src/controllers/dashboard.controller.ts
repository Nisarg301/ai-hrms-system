import { Request, Response } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { moduleCounts } from '../services/dashboard.service';
import { successResponse } from '../utils/apiResponse';

export const getDashboardSummary = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(successResponse(await moduleCounts(req.user!, req.orgFilter!.organizationId)));
});
