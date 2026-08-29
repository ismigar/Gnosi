import { useMemo } from 'react';

import { normalizeSorts } from '../components/Vault/schemaUtils';
import {
  compareFieldValues,
  matchesSearch,
  viewMatchesFilters,
  type FilterItem,
  type FilterNode,
  type FilterValue,
} from '../utils/vaultFilters';


export interface VaultViewPage extends FilterItem {
  readonly id: string;
  readonly metadata?: Readonly<Record<string, FilterValue>>;
}


export interface VaultSortInput {
  readonly direction?: string;
  readonly field?: string;
  readonly id?: string;
}


export interface VaultViewConfig {
  readonly [key: string]: unknown;
  readonly filters?: readonly FilterNode[];
  readonly filterTree?: FilterNode;
  readonly sort?: VaultSortInput | VaultSortInput[] | null;
  readonly sorts?: VaultSortInput | VaultSortInput[] | null;
}


export interface VaultViewDataParams {
  readonly pages?: readonly VaultViewPage[];
  readonly schema?: Readonly<Record<string, unknown>>;
  readonly searchTerm?: string;
  readonly view?: VaultViewConfig;
}


export interface VaultViewDataResult {
  readonly filteredPages: VaultViewPage[];
  readonly sortedPages: VaultViewPage[];
}


interface VaultSort {
  readonly direction: string;
  readonly field: string;
  readonly id: string;
}


/** Apply shared search, nested filters, and stable multi-field sorting. */
export function useVaultViewData({
  pages = [],
  view = {},
  searchTerm = '',
}: VaultViewDataParams): VaultViewDataResult {
  const filterView = useMemo(() => ({
    filters: view.filters,
    filterTree: view.filterTree,
  }), [view.filters, view.filterTree]);

  const filteredPages = useMemo(() => pages.filter((page) => (
    matchesSearch(page, searchTerm)
      && viewMatchesFilters(page, filterView)
  )), [filterView, pages, searchTerm]);

  const sortedPages = useMemo(() => {
    const sorts = normalizeSorts(view.sort ?? view.sorts) as readonly VaultSort[];
    if (sorts.length === 0) return [...filteredPages];

    return [...filteredPages].sort((first, second) => {
      for (const sort of sorts) {
        const firstValue = sort.field === 'title'
          ? first.title ?? ''
          : first.metadata?.[sort.field] ?? first[sort.field];
        const secondValue = sort.field === 'title'
          ? second.title ?? ''
          : second.metadata?.[sort.field] ?? second[sort.field];
        const comparison = compareFieldValues(
          firstValue,
          secondValue,
          sort.direction,
        );
        if (comparison !== 0) return comparison;
      }
      return 0;
    });
  }, [filteredPages, view.sort, view.sorts]);

  return { filteredPages, sortedPages };
}
