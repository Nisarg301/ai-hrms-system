import { ApiError } from '../types/api';

/** A thunk's generic failure message, for rejections that carry no field data. */
export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong';
}

/**
 * A plain, serializable shape that survives Redux Toolkit's rejectWithValue
 * round-trip with the ApiError's status/details intact — RTK's own `action.error`
 * is always a generic placeholder, and a bare ApiError instance isn't
 * serializable-safe for the store, so thunks that need field-level error mapping
 * (via applyServerFieldErrors) reject with this shape instead of a bare string.
 */
export interface FieldAwareError {
  message: string;
  status: number;
  details?: unknown;
}

export function toFieldAwareError(err: unknown): FieldAwareError {
  if (err instanceof ApiError) {
    return { message: err.message, status: err.status, details: err.details };
  }
  return { message: 'Something went wrong', status: 0 };
}
