export interface ApiSuccessBody<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  success: false;
  error: { message: string; details?: unknown };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

/** Shared by every list slice so the states cannot drift apart. */
export type ListStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

/**
 * The envelope types `meta` loosely, so narrow it here once rather than
 * double-casting at each call site. Falls back to the request's own paging when
 * the server omits meta.
 */
export function toPaginationMeta(
  meta: Record<string, unknown> | undefined,
  fallback: PaginationMeta
): PaginationMeta {
  if (!meta) return fallback;
  const page = typeof meta.page === 'number' ? meta.page : fallback.page;
  const limit = typeof meta.limit === 'number' ? meta.limit : fallback.limit;
  const total = typeof meta.total === 'number' ? meta.total : fallback.total;
  return { page, limit, total };
}

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/** Shape of the Zod flatten() payload the backend returns in error.details on a 400. */
export interface ValidationDetails {
  formErrors?: string[];
  fieldErrors?: Record<string, string[]>;
}
