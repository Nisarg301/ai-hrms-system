import { describe, expect, it } from 'vitest';
import { ApiError, toPaginationMeta } from './api';

describe('ApiError', () => {
  it('carries status, message, and details', () => {
    const err = new ApiError(400, 'Validation failed', { fieldErrors: { email: ['Invalid'] } });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(400);
    expect(err.message).toBe('Validation failed');
    expect(err.details).toEqual({ fieldErrors: { email: ['Invalid'] } });
  });

  it('works without details', () => {
    const err = new ApiError(500, 'Internal server error');
    expect(err.status).toBe(500);
    expect(err.details).toBeUndefined();
  });
});

describe('toPaginationMeta', () => {
  it('narrows a well-formed meta object', () => {
    expect(toPaginationMeta({ page: 2, limit: 5, total: 42 }, { page: 1, limit: 10, total: 0 })).toEqual({
      page: 2,
      limit: 5,
      total: 42,
    });
  });

  it('falls back when meta is missing', () => {
    expect(toPaginationMeta(undefined, { page: 3, limit: 20, total: 7 })).toEqual({ page: 3, limit: 20, total: 7 });
  });

  it('falls back per field when a value is the wrong type', () => {
    expect(toPaginationMeta({ page: 'two', total: 9 }, { page: 1, limit: 10, total: 0 })).toEqual({
      page: 1,
      limit: 10,
      total: 9,
    });
  });
});
