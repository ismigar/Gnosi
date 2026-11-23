import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRequestContext } from '../hooks/useRequestContext';
import { GnosiApiError } from './errors';
import { fetchHomePreferences, homePreferencesKey, saveHomePreferences, type HomePreferences } from './home-canvas';
import type { RequestContext } from './request-context';

export function useHomePreferences() {
    const scope = useRequestContext();
    const client = useQueryClient();
    const query = useQuery({
        queryKey: homePreferencesKey(scope),
        queryFn: ({ signal }) => fetchHomePreferences(scope, signal),
        enabled: Boolean(scope.vaultId),
        staleTime: 0,
    });
    const mutation = useMutation({
        mutationFn: ({ owner, value }: { owner: RequestContext; value: HomePreferences }) => saveHomePreferences(owner, value),
        onSuccess: async (result, { owner }) => {
            const queryKey = homePreferencesKey(owner);
            await client.cancelQueries({ queryKey, exact: true });
            client.setQueryData(queryKey, result);
        },
        onError: (error, { owner }) => {
            if (error instanceof GnosiApiError && error.status === 409) {
                void client.invalidateQueries({ queryKey: homePreferencesKey(owner), exact: true });
            }
        },
    });
    return { query, scope, mutation, save: (value: HomePreferences) => mutation.mutateAsync({ owner: scope, value }) };
}
