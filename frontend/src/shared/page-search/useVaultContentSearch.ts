import { useEffect, useRef, useState } from 'react';

import { GnosiApiError } from '../api/errors';
import { currentRequestContext } from '../api/request-context';
import { searchVaultContent, type VaultSearchHit } from '../api/vault-search';
import { useActiveVaultId } from '../hooks/useActiveVaultId';
import { useRequestContext } from '../hooks/useRequestContext';
import { subscribeAppEvent } from '../platform/app-events';

interface SearchState {
  readonly key: string;
  readonly results: readonly VaultSearchHit[];
  readonly total: number;
  readonly loading: boolean;
  readonly error: 'query' | 'network' | null;
}

const EMPTY_RESULTS: readonly VaultSearchHit[] = [];

export function useVaultContentSearch(query: string, vaultId?: string | null) {
  const activeVaultId = useActiveVaultId();
  const context = useRequestContext();
  const contextKey = JSON.stringify(currentRequestContext());
  const scope = vaultId ?? activeVaultId;
  const normalizedQuery = query.trim();
  const key = JSON.stringify([contextKey, scope, normalizedQuery]);
  const [request, setRequest] = useState({ key: '', offset: 0 });
  const [revision, setRevision] = useState(0);
  const activeSearch = useRef<AbortController | null>(null);
  const [state, setState] = useState<SearchState>({ key: '', results: [], total: 0, loading: false, error: null });
  const offset = request.key === key ? request.offset : 0;

  useEffect(() => {
    const refresh = () => {
      activeSearch.current?.abort();
      setRequest({ key: '', offset: 0 });
      setState({ key: '', results: [], total: 0, loading: false, error: null });
      setRevision((value) => value + 1);
    };
    const stops = [
      subscribeAppEvent('gnosi:invalidatePreview', refresh),
      subscribeAppEvent('gnosi:page-deleted', refresh),
      subscribeAppEvent('gnosi:imported', refresh),
    ];
    return () => { for (const stop of stops) stop(); };
  }, []);

  useEffect(() => {
    if (!normalizedQuery) return;
    const controller = new AbortController();
    activeSearch.current = controller;
    const isCurrent = () => !controller.signal.aborted && JSON.stringify(currentRequestContext()) === contextKey;
    const timer = window.setTimeout(() => {
      if (!isCurrent()) return;
      setState((previous) => ({
        key,
        results: previous.key === key && offset > 0 ? previous.results : [],
        total: previous.key === key ? previous.total : 0,
        loading: true,
        error: null,
      }));
      void searchVaultContent(normalizedQuery, { signal: controller.signal, offset, vaultId: scope, context })
        .then((response) => {
          if (!isCurrent()) return;
          setState((previous) => ({
            key,
            results: [...(previous.key === key && offset > 0 ? previous.results : []), ...response.results],
            total: response.total,
            loading: false,
            error: null,
          }));
        })
        .catch((error: unknown) => {
          if (!isCurrent()) return;
          setState((previous) => ({
            ...previous,
            key,
            loading: false,
            error: error instanceof GnosiApiError && error.status === 422 ? 'query' : 'network',
          }));
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (activeSearch.current === controller) activeSearch.current = null;
    };
  }, [context, contextKey, key, normalizedQuery, offset, revision, scope]);

  const current = state.key === key;
  return {
    results: current ? state.results : EMPTY_RESULTS,
    total: current ? state.total : 0,
    loading: Boolean(normalizedQuery) && (!current || state.loading),
    error: current ? state.error : null,
    loadMore: () => { if (current && !state.loading) setRequest({ key, offset: state.results.length }); },
    retry: () => { setRevision((value) => value + 1); },
  };
}
