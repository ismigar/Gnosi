import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { fetchContacts, type ContactQuery } from './contacts';

export const contactQueryKeys = {
  all: ['contacts'] as const,
  list: (query: ContactQuery) => ['contacts', 'list', query] as const,
};

export function useContacts(query: ContactQuery) {
  return useQuery({
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchContacts(query, signal),
    queryKey: contactQueryKeys.list(query),
  });
}
