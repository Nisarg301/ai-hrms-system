import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../types/api';
import { applyServerFieldErrors } from './applyServerFieldErrors';

describe('applyServerFieldErrors', () => {
  it('maps the backend fieldErrors onto matching form fields', () => {
    const setError = vi.fn();
    const err = new ApiError(400, 'Validation failed', {
      formErrors: [],
      fieldErrors: { email: ['Invalid email'], name: ['Required'] },
    });

    const handled = applyServerFieldErrors(err, setError, ['email', 'name']);

    expect(handled).toBe(true);
    expect(setError).toHaveBeenCalledWith('email', { type: 'server', message: 'Invalid email' });
    expect(setError).toHaveBeenCalledWith('name', { type: 'server', message: 'Required' });
  });

  it('ignores fields the form does not have, and reports unhandled', () => {
    const setError = vi.fn();
    const err = new ApiError(400, 'Validation failed', { fieldErrors: { somethingElse: ['Nope'] } });

    const handled = applyServerFieldErrors(err, setError, ['email']);

    expect(handled).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns false for a non-validation error so the caller shows a banner instead', () => {
    const setError = vi.fn();
    const err = new ApiError(409, 'A user with this email already exists');

    expect(applyServerFieldErrors(err, setError, ['email'])).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns false for a non-ApiError', () => {
    expect(applyServerFieldErrors(new Error('boom'), vi.fn(), ['email'])).toBe(false);
  });
});
