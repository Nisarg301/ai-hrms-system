import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { ApiError } from '../utils/apiResponse';

export function validateObjectId(paramName = 'id') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!Types.ObjectId.isValid(req.params[paramName])) {
      throw new ApiError(400, 'Invalid id format');
    }
    next();
  };
}
