import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';

import { toast } from '../../../shared/notifications/toast';
import { apiErrorDetail } from '../../../shared/api/errors';
import {
  cancelLiteratureSearch,
  captureLiteratureWork,
  createLiteratureSearch,
  fetchLiteratureSearch,
  fetchLiteratureSearches,
  importLiteratureWorks,
  runLiteratureAi,
  type LiteratureJson,
} from '../../../shared/api/literature';
import {
  fetchLiteratureConfiguration,
  updateLiteratureConfiguration,
  type LiteratureConfiguration,
} from '../../../shared/api/literature-resources';
import { openEventStream, supportsEventStreams } from '../../../shared/api/specialized-transports';
import { emitAppEvent } from '../../../shared/platform/app-events';
import { defineStorageKey, stringStorageCodec, writeStorage } from '../../../shared/platform/browser-storage';
import {
  EMPTY_FILTERS,
  filtersFromSearch,
  rankWorks,
  SEARCH_EVENTS,
  SEARCH_PAGE_SIZE,
  searchWorks,
  TERMINAL_SEARCH_STATES,
} from './literatureModel';
import type {
  LiteratureAiResultView,
  LiteratureFilters,
  LiteratureSearchView,
  LiteratureWorkView,
  ManualKind,
  Translate,
} from './literatureTypes';
import {
  asAiResult,
  asSearch,
  asWork,
} from './literatureTypes';

const CONFIGURE_PLUGIN_KEY = defineStorageKey(
  'gnosi:configure-plugin',
  stringStorageCodec,
  'session',
);

const EMPTY_CONFIGURATION: LiteratureConfiguration = {
  ai_agent_id: '',
  ai_agents: [],
  contact_email: '',
  hidden_sources: [],
  source_defaults: {},
  sources: [],
};

interface UseLiteratureSearchOptions {
  readonly t: Translate;
}

export function useLiteratureSearch({ t }: UseLiteratureSearchOptions) {
  const [tab, setTab] = useState<'reviews' | 'search'>('search');
  const [configuration, setConfiguration] = useState(EMPTY_CONFIGURATION);
  const [aiAgentId, setAiAgentId] = useState('');
  const [query, setQuery] = useState('');
  const [sourceQueries, setSourceQueries] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState<LiteratureFilters>(EMPTY_FILTERS);
  const [selectedSources, setSelectedSources] = useState<ReadonlySet<string>>(new Set());
  const [searchResult, setSearchResult] = useState<LiteratureSearchView | null>(null);
  const [searchHistory, setSearchHistory] = useState<readonly LiteratureSearchView[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [resultOffset, setResultOffset] = useState(0);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedWorkMap, setSelectedWorkMap] = useState<ReadonlyMap<string, LiteratureWorkView>>(
    new Map(),
  );
  const [preview, setPreview] = useState<LiteratureWorkView | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [aiProposal, setAiProposal] = useState<LiteratureAiResultView | null>(null);
  const [aiAudits, setAiAudits] = useState<readonly LiteratureJson[]>([]);
  const [rerankAudit, setRerankAudit] = useState<LiteratureJson | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [manualKind, setManualKind] = useState<ManualKind>('auto');
  const [manualWork, setManualWork] = useState<LiteratureWorkView | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const eventCursorRef = useRef(0);
  const resultOffsetRef = useRef(0);

  const loadConfiguration = useCallback(async () => {
    try {
      const next = await fetchLiteratureConfiguration();
      setConfiguration(next);
      const firstAgent = next.ai_agents.find((agent) => typeof agent.id === 'string');
      setAiAgentId((current) => (
        current || next.ai_agent_id || (typeof firstAgent?.id === 'string' ? firstAgent.id : '')
      ));
      setSelectedSources((current) => current.size ? current : new Set(
        next.sources
          .filter((source) => (
            source.enabled && source.available && source.automated && !source.hidden
          ))
          .map((source) => source.id),
      ));
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.search.load_error')));
    }
  }, [t]);

  const loadSearchHistory = useCallback(async () => {
    try {
      setSearchHistory((await fetchLiteratureSearches(50)).map(asSearch));
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadConfiguration);
    void Promise.resolve().then(loadSearchHistory);
  }, [loadConfiguration, loadSearchHistory]);

  const stopProgress = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => () => { stopProgress(); }, [stopProgress]);

  const refreshSearch = useCallback(async (
    searchId: string,
    offset = resultOffsetRef.current,
  ): Promise<LiteratureSearchView | null> => {
    try {
      const nextSearch = asSearch(
        await fetchLiteratureSearch(searchId, offset, SEARCH_PAGE_SIZE),
      );
      setSearchResult(nextSearch);
      if (TERMINAL_SEARCH_STATES.has(nextSearch.state)) {
        stopProgress();
        void loadSearchHistory();
      }
      return nextSearch;
    } catch {
      return null;
    }
  }, [loadSearchHistory, stopProgress]);

  const startPolling = useCallback((searchId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void refreshSearch(searchId), 1_500);
  }, [refreshSearch]);

  const followSearch = useCallback((searchId: string) => {
    stopProgress();
    if (!supportsEventStreams()) {
      startPolling(searchId);
      return;
    }
    const stream = openEventStream(
      `/api/vault/literature/searches/${encodeURIComponent(searchId)}/events?after=${eventCursorRef.current.toString()}`,
    );
    eventSourceRef.current = stream;
    SEARCH_EVENTS.forEach((eventName) => { stream.addEventListener(eventName, (event) => {
      const sequence = event instanceof MessageEvent ? Number(event.lastEventId || 0) : 0;
      if (sequence > eventCursorRef.current) eventCursorRef.current = sequence;
      void refreshSearch(searchId);
    }); });
    stream.onerror = () => {
      if (eventSourceRef.current === stream) {
        stream.close();
        eventSourceRef.current = null;
        startPolling(searchId);
      }
    };
  }, [refreshSearch, startPolling, stopProgress]);

  const openSearch = useCallback(async (searchId: string, offset = 0) => {
    stopProgress();
    resultOffsetRef.current = offset;
    setResultOffset(offset);
    setSelectedIds(new Set());
    setSelectedWorkMap(new Map());
    setRerankAudit(null);
    eventCursorRef.current = 0;
    const loaded = await refreshSearch(searchId, offset);
    if (!loaded) return;
    setQuery(loaded.query ?? '');
    setFilters(filtersFromSearch(loaded.filters));
    setSelectedSources(new Set(loaded.source_ids ?? []));
    setSourceQueries({ ...(loaded.source_queries ?? {}) });
    setAiAudits(loaded.ai_audits ?? []);
    if (!TERMINAL_SEARCH_STATES.has(loaded.state)) followSearch(searchId);
  }, [followSearch, refreshSearch, stopProgress]);

  const executeSearch = async (searchQuery: string): Promise<void> => {
    const normalizedQuery = searchQuery.trim();
    if (!normalizedQuery || !selectedSources.size) return;
    setBusy('search');
    setError('');
    setSelectedIds(new Set());
    setSelectedWorkMap(new Map());
    setAiProposal(null);
    setRerankAudit(null);
    stopProgress();
    resultOffsetRef.current = 0;
    setResultOffset(0);
    eventCursorRef.current = 0;
    try {
      const created = asSearch(await createLiteratureSearch({
        ai_audits: [...aiAudits],
        filters,
        limit_per_source: 25,
        query: normalizedQuery,
        source_ids: [...selectedSources],
        source_queries: sourceQueries,
      }));
      setSearchResult(created);
      const refreshed = await refreshSearch(created.id, 0);
      if (refreshed && !TERMINAL_SEARCH_STATES.has(refreshed.state)) {
        followSearch(created.id);
      }
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.search.start_error')));
    } finally {
      setBusy('');
    }
  };

  const startSearch = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await executeSearch(query);
  };

  const cancelSearch = async (): Promise<void> => {
    if (!searchResult?.id || TERMINAL_SEARCH_STATES.has(searchResult.state)) return;
    setBusy('cancel');
    try {
      await cancelLiteratureSearch(searchResult.id);
      await refreshSearch(searchResult.id);
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.search.cancel_error')));
    } finally {
      setBusy('');
    }
  };

  const changePage = async (nextOffset: number): Promise<void> => {
    if (!searchResult?.id) return;
    const bounded = Math.max(0, nextOffset);
    resultOffsetRef.current = bounded;
    setResultOffset(bounded);
    await refreshSearch(searchResult.id, bounded);
  };

  const rememberAi = (result: LiteratureAiResultView): void => {
    setAiProposal(result);
    setAiAudits((current) => [
      ...current,
      { operation: result.operation, ...result.audit },
    ].slice(-50));
  };

  const runAiQuery = async (): Promise<void> => {
    if (!query.trim()) {
      toast.error(t('literature.ai.enter_question'));
      return;
    }
    setBusy('ai');
    try {
      rememberAi(asAiResult(await runLiteratureAi({
        agent_id: aiAgentId,
        operation: 'query_strategy',
        payload: { framework: 'AUTO', languages: ['ca', 'es', 'en', 'fr'], question: query },
      })));
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.ai.error')));
    } finally {
      setBusy('');
    }
  };

  const runAiTranslation = async (sourceId: string): Promise<void> => {
    if (!query.trim()) return;
    setBusy(`translate:${sourceId}`);
    try {
      rememberAi(asAiResult(await runLiteratureAi({
        agent_id: aiAgentId,
        operation: 'translate_query',
        payload: { query, source_id: sourceId },
      })));
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.ai.error')));
    } finally {
      setBusy('');
    }
  };

  const changeAiAgent = async (agentId: string): Promise<void> => {
    setAiAgentId(agentId);
    try {
      await updateLiteratureConfiguration({ ai_agent_id: agentId });
      setConfiguration((current) => ({ ...current, ai_agent_id: agentId }));
    } catch {
      toast.error(t('literature.ai.agent_save_error'));
    }
  };

  const results = searchWorks(searchResult);

  const rerankResults = async (): Promise<void> => {
    if (!results.length || !searchResult?.query) return;
    setBusy('rerank');
    try {
      const aiResult = asAiResult(await runLiteratureAi({
        operation: 'rerank',
        payload: { mode: 'local', query: searchResult.query, works: results },
        search_id: searchResult.id,
      }));
      const ranks = new Map(aiResult.result.ranking?.map((item) => [item.id, item]) ?? []);
      const auditEntry = { operation: aiResult.operation, ...aiResult.audit };
      setAiAudits((current) => [...current, auditEntry].slice(-50));
      setSearchResult((current) => current ? {
        ...current,
        ai_audits: [...(current.ai_audits ?? []), auditEntry].slice(-50),
        results: rankWorks(current.results ?? [], ranks),
      } : current);
      setRerankAudit(aiResult.audit);
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.ai.rerank_error')));
    } finally {
      setBusy('');
    }
  };

  const captureManualWork = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!manualValue.trim()) return;
    setBusy('manual');
    setError('');
    try {
      setManualWork(asWork(await captureLiteratureWork(manualValue.trim(), manualKind)));
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.manual.error')));
    } finally {
      setBusy('');
    }
  };

  const importWorks = async (
    works: readonly LiteratureWorkView[],
    sendToNotebook = false,
  ): Promise<void> => {
    if (!works.length) return;
    setBusy(sendToNotebook ? 'notebook' : 'import');
    try {
      const result = await importLiteratureWorks([...works]);
      toast.success(t('literature.import.success', {
        existing: result.existing_count,
        imported: result.imported_count,
      }));
      if (sendToNotebook && result.resource_ids.length) {
        emitAppEvent('gnosi:create-notebook', { resourceIds: result.resource_ids });
      }
      const membership = [...result.imported, ...result.existing]
        .find((item) => item.work_id === manualWork?.id);
      if (membership) {
        setManualWork((current) => current ? {
          ...current,
          in_resources: true,
          resource_id: membership.resource_id,
        } : current);
        setPreview((current) => current?.id === membership.work_id ? {
          ...current,
          in_resources: true,
          resource_id: membership.resource_id,
        } : current);
      }
      if (searchResult?.id) await refreshSearch(searchResult.id);
    } catch (requestError) {
      setError(apiErrorDetail(requestError, t('literature.import.error')));
    } finally {
      setBusy('');
    }
  };

  const selectedWorks = useMemo(
    () => Array.from(selectedWorkMap.values()),
    [selectedWorkMap],
  );

  const toggleWork = useCallback((work: LiteratureWorkView, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(work.id);
      else next.delete(work.id);
      return next;
    });
    setSelectedWorkMap((current) => {
      const next = new Map(current);
      if (checked) next.set(work.id, work);
      else next.delete(work.id);
      return next;
    });
  }, []);

  const openResourcesSettings = (): void => {
    writeStorage(CONFIGURE_PLUGIN_KEY, 'resources');
    emitAppEvent('open-settings', { pluginId: 'resources', tab: 'plugins' });
  };

  const toggleSource = (sourceId: string, checked: boolean): void => {
    setSelectedSources((current) => {
      const next = new Set(current);
      if (checked) next.add(sourceId);
      else next.delete(sourceId);
      return next;
    });
  };

  return {
    actions: {
      cancelSearch,
      captureManualWork,
      changeAiAgent,
      changePage,
      executeSearch,
      importWorks,
      loadSearchHistory,
      openResourcesSettings,
      openSearch,
      rerankResults,
      runAiQuery,
      runAiTranslation,
      startSearch,
      toggleSource,
      toggleWork,
    },
    state: {
      aiAgentId,
      aiProposal,
      busy,
      configuration,
      error,
      filters,
      manualKind,
      manualValue,
      manualWork,
      preview,
      query,
      rerankAudit,
      resultOffset,
      results,
      searchHistory,
      searchResult,
      selectedIds,
      selectedSources,
      selectedWorks,
      showFilters,
      showHistory,
      sourceQueries,
      tab,
    },
    setters: {
      setAiAudits,
      setAiProposal,
      setFilters,
      setManualKind,
      setManualValue,
      setPreview,
      setQuery,
      setShowFilters,
      setShowHistory,
      setSourceQueries,
      setTab,
    },
  };
}

export type LiteratureSearchController = ReturnType<typeof useLiteratureSearch>;
