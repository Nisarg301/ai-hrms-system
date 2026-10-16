import { ApiError, type ValidationDetails } from '../types/api';

type SetError = (field: string, error: { type: string; message: string }) => void;

/**
 * The backend puts Zod's flatten() output in error.details on a 400. Put those
 * messages on the fields they belong to instead of only in a banner.
 *
 * Returns true when at least one message was placed on a field; false means the
 * caller should surface the error some other way (a banner).
 */
export function applyServerFieldErrors(error: unknown, setError: SetError, knownFields: string[]): boolean {
  if (!(error instanceof ApiError) || error.status !== 400) {
    return false;
  }

  const details = error.details as ValidationDetails | undefined;
  const fieldErrors = details?.fieldErrors;
  if (!fieldErrors) {
    return false;
  }

  let applied = false;
  for (const field of knownFields) {
    const messages = fieldErrors[field];
    if (messages && messages.length > 0) {
      setError(field, { type: 'server', message: messages[0] });
      applied = true;
    }
  }
  return applied;
}
