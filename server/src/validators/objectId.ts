import { z } from 'zod';
import { Types } from 'mongoose';

// A body field that references another record. Rejecting malformed ids here keeps
// them from reaching Mongoose, where they would surface as a 500 CastError.
export const objectIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => Types.ObjectId.isValid(value), 'Invalid id format');
