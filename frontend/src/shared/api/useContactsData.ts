import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  createContact,
  deleteContact,
  fetchContacts,
  updateContact,
  type ContactQuery,
  type ContactWriteInput,
} from './contacts';

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


export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createContact,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: contactQueryKeys.all });
    },
  });
}


interface UpdateContactMutationInput {
  readonly contactId: string;
  readonly input: ContactWriteInput;
}


export function useUpdateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, input }: UpdateContactMutationInput) => (
      updateContact(contactId, input)
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: contactQueryKeys.all });
    },
  });
}


export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteContact,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: contactQueryKeys.all });
    },
  });
}
