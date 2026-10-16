export interface ParsedPagination {
  page: number;
  limit: number;
  skip: number;
  search: string | undefined;
  sortBy: string;
  sortDir: 1 | -1;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

export function parsePaginationQuery(query: Record<string, unknown>): ParsedPagination {
  const page = Math.max(1, Number(query.page) || 1);
  const rawLimit = Number(query.limit) || DEFAULT_LIMIT;
  const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);
  const sortBy = typeof query.sortBy === 'string' && query.sortBy.length > 0 ? query.sortBy : 'createdAt';
  const sortDir: 1 | -1 = query.sortDir === 'asc' ? 1 : -1;
  const search = typeof query.search === 'string' && query.search.trim().length > 0 ? query.search.trim() : undefined;

  return { page, limit, skip: (page - 1) * limit, search, sortBy, sortDir };
}
