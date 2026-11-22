import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchVaultPage, fetchVaultSidebarSummary } from '../../../shared/api/vaults';
import { fetchPageViews, fetchVaultViews } from '../../../shared/api/vault-views';
import { GnosiApiError } from '../../../shared/api/errors';
import type { RequestContext } from '../../../shared/api/request-context';
import { subscribeAppEvent } from '../../../shared/platform/app-events';
import { subscribePersonalEdits } from '../../../shared/records/personalNoteEdits';
import { isDashboardPage } from '../../../shared/records/model/pageKind';
import { dashboardLayout } from './dashboardModel';

export function useKnowledgeQuery<T>(scope: RequestContext, key: readonly unknown[], read: (signal: AbortSignal) => Promise<T>, enabled = true) {
  return useQuery({
    queryKey: ['home-knowledge', scope, ...key],
    queryFn: ({ signal }) => read(signal),
    enabled: enabled && Boolean(scope.vaultId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useKnowledgeCatalog(scope: RequestContext) {
  const client = useQueryClient();
  useEffect(() => {
    const refresh = () => { void client.invalidateQueries({ queryKey: ['home-knowledge', scope] }, { cancelRefetch: false }); };
    const saved = subscribePersonalEdits(refresh, scope);
    const changed = subscribeAppEvent('gnosi:invalidatePreview', refresh);
    const deleted = subscribeAppEvent('gnosi:page-deleted', refresh);
    return () => { saved(); changed(); deleted(); };
  }, [client, scope]);
  return useKnowledgeQuery(scope, ['pages'], signal => fetchVaultSidebarSummary(signal, scope));
}

function registryFallback<T>(error: unknown, fallback: T): T {
  if (error instanceof GnosiApiError && error.status === 404) return fallback;
  throw error;
}

export async function readDashboard(id: string, scope: RequestContext, signal: AbortSignal) {
  const [page, { sections }] = await Promise.all([
    fetchVaultPage(id, signal, scope),
    fetchPageViews(id, signal, scope).catch((error: unknown) => registryFallback(error, { sections: [] })),
  ]);
  if (!isDashboardPage(page)) return null;
  const layout = dashboardLayout(page.content, sections);
  const parts = layout.partsFor('') ?? [];
  const registered = parts.some(part => part.kind === 'view' && part.view.view_id)
    ? await fetchVaultViews(undefined, signal, scope).catch((error: unknown) => registryFallback(error, [])) : [];
  return { layout, registered };
}
