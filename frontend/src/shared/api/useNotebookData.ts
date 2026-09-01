import { keepPreviousData, useQuery } from '@tanstack/react-query';

import {
  fetchNotebooks,
  fetchReferenceResources,
  type NotebookListQuery,
  type ReferenceResourceQuery,
} from './notebooks';


export const notebookQueryKeys = {
  all: ['notebooks'] as const,
  library: (query: NotebookListQuery) => ['notebooks', 'library', query] as const,
  resources: (query: ReferenceResourceQuery) =>
    ['notebooks', 'resources', query] as const,
};


export function useNotebookLibrary(query: NotebookListQuery) {
  return useQuery({
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchNotebooks(query, signal),
    queryKey: notebookQueryKeys.library(query),
  });
}


export function useReferenceResources(query: ReferenceResourceQuery) {
  return useQuery({
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchReferenceResources(query, signal),
    queryKey: notebookQueryKeys.resources(query),
  });
}
