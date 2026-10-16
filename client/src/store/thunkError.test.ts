import { describe, expect, it } from 'vitest';
import { ApiError } from '../types/api';
import { errorMessage, toFieldAwareError } from './thunkError';

describe('errorMessage', () => {
  it("returns an ApiError's message", () => {
    expect(errorMessage(new ApiError(404, 'Not found'))).toBe('Not found');
  });

  it('falls back to a generic message for a non-ApiError', () => {
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong');
    expect(errorMessage(undefined)).toBe('Something went wrong');
  });
});

describe('toFieldAwareError', () => {
  it("preserves an ApiError's message, status, and details", () => {
    const details = { fieldErrors: { title: ['Title is required'] } };
    expect(toFieldAwareError(new ApiError(400, 'Validation failed', details))).toEqual({
      message: 'Validation failed',
      status: 400,
      details,
    });
  });

  it('falls back to a generic shape with status 0 for a non-ApiError', () => {
    expect(toFieldAwareError(new Error('boom'))).toEqual({ message: 'Something went wrong', status: 0 });
  });
});
