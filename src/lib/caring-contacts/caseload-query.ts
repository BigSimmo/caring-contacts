// src/lib/caring-contacts/caseload-query.ts
//
// Caseload query filtering and pagination.
//
// Bug fix #LM33K2:
// Caseload pagination boundary previously dropped the patient on exact page-size counts
// due to an off-by-one boundary condition (`<=` vs `<`). This module implements exact
// pagination bounds and handles edge cases such as empty lists and pagination beyond
// the last page.

export type CaseloadPaginationOptions = {
  /** 1-indexed page number. Defaults to 1. */
  page?: number;
  /** Number of records per page. Defaults to 10. Must be >= 1. */
  pageSize?: number;
};

export type CaseloadQueryOptions<T = unknown> = CaseloadPaginationOptions & {
  /** Optional search term matching patient name, patientId, planId, or referralId. */
  query?: string;
  /** Optional plan state filter (e.g. "active", "draft", "completed"). */
  state?: string;
  /** Optional custom filter predicate. */
  filterFn?: (item: T) => boolean;
};

export type PaginatedCaseloadResult<T> = {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export const DEFAULT_CASELOAD_PAGE_SIZE = 10;

/**
 * Paginates an array of caseload records.
 *
 * Boundary condition fix (#LM33K2):
 * When `totalCount` equals an exact multiple of `pageSize` (e.g. 10 items with `pageSize = 10`),
 * the N-th patient is included in the page items and is never dropped.
 */
export function paginateCaseload<T>(
  items: readonly T[],
  options: CaseloadPaginationOptions = {},
): PaginatedCaseloadResult<T> {
  const totalCount = items.length;
  const rawPageSize = options.pageSize ?? DEFAULT_CASELOAD_PAGE_SIZE;
  const pageSize =
    Number.isFinite(rawPageSize) && Math.floor(rawPageSize) >= 1 ? Math.floor(rawPageSize) : DEFAULT_CASELOAD_PAGE_SIZE;
  const totalPages = totalCount === 0 ? 1 : Math.ceil(totalCount / pageSize);

  const rawPage = options.page ?? 1;
  const page = Number.isFinite(rawPage) && Math.floor(rawPage) >= 1 ? Math.floor(rawPage) : 1;

  // Beyond last page edge case: return empty items without failing
  if (page > totalPages) {
    return {
      items: [],
      totalCount,
      page,
      pageSize,
      totalPages,
      hasNextPage: false,
      hasPreviousPage: totalCount > 0,
    };
  }

  const startIndex = (page - 1) * pageSize;
  // Exact boundary: endIndex uses exact `<` upper-bound slice `startIndex + pageSize`.
  // Under the old bug (`<=` offset check), an exact page count `totalCount === pageSize`
  // had computed an exclusive bound of `pageSize - 1`, dropping the exact last patient.
  const endIndex = Math.min(startIndex + pageSize, totalCount);
  const paginatedItems = totalCount === 0 ? [] : items.slice(startIndex, endIndex);

  return {
    items: paginatedItems,
    totalCount,
    page,
    pageSize,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalCount > 0,
  };
}

export type CaseloadRecord = {
  patientId: string;
  patientName?: string | null;
  planId?: string;
  referralId?: string;
  state?: string;
  [key: string]: unknown;
};

/**
 * Filters and paginates a caseload list by search query and optional state.
 */
export function queryCaseload<T extends CaseloadRecord>(
  records: readonly T[],
  options: CaseloadQueryOptions<T> = {},
): PaginatedCaseloadResult<T> {
  let filtered = records;

  if (options.state && options.state !== "all") {
    filtered = filtered.filter((r) => r.state === options.state);
  }

  if (options.query && options.query.trim() !== "") {
    const needle = options.query.trim().toLowerCase();
    filtered = filtered.filter((r) => {
      const haystack = [r.patientName ?? "", r.patientId ?? "", r.planId ?? "", r.referralId ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  if (options.filterFn) {
    filtered = filtered.filter(options.filterFn);
  }

  return paginateCaseload(filtered, options);
}
