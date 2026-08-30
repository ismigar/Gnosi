import {
  ChevronDown,
  ChevronRight,
  Clock3,
  Filter,
  LoaderCircle,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useRef, type RefObject } from 'react';

import { agentsFromConfiguration } from './literatureTypes';
import { TERMINAL_SEARCH_STATES } from './literatureModel';
import { LanguageFilter, SourcePicker } from './SearchControls';
import { SearchAncillary } from './SearchAncillary';
import { SearchResultsArea } from './SearchResultsArea';
import type { LiteratureSearchController } from './useLiteratureSearch';
import type { Translate } from './literatureTypes';

interface SearchWorkspaceProps {
  readonly controller: LiteratureSearchController;
  readonly language: string;
  readonly t: Translate;
}

interface SearchPanelProps extends SearchWorkspaceProps {
  readonly queryInputRef: RefObject<HTMLInputElement | null>;
}

function SearchPanel({ controller, language, queryInputRef, t }: SearchPanelProps) {
  const { actions, setters, state } = controller;
  const agents = agentsFromConfiguration(state.configuration.ai_agents);
  const rerankModel = typeof state.rerankAudit?.model === 'string'
    ? state.rerankAudit.model
    : '';
  return (
    <section className="literature-search-panel">
      <form onSubmit={(event) => void actions.startSearch(event)}>
        <div className="literature-search-box">
          <Search size={19} />
          <input
            aria-label={t('literature.search.query')}
            onChange={(event) => {
              setters.setQuery(event.target.value);
              setters.setSourceQueries({});
              setters.setAiProposal(null);
              setters.setAiAudits([]);
            }}
            placeholder={t('literature.search.placeholder')}
            ref={queryInputRef}
            value={state.query}
          />
          {agents.length > 0 && (
            <select
              aria-label={t('literature.ai.agent')}
              className="literature-ai-agent"
              onChange={(event) => void actions.changeAiAgent(event.target.value)}
              title={t('literature.ai.agent')}
              value={state.aiAgentId}
            >
              <option value="">{t('literature.ai.default_agent')}</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}{agent.model ? ` · ${agent.model}` : ''}
                </option>
              ))}
            </select>
          )}
          <button
            aria-busy={state.busy === 'ai'}
            className="literature-ai-button"
            disabled={state.busy === 'ai'}
            onClick={() => {
              if (!state.query.trim()) queryInputRef.current?.focus();
              void actions.runAiQuery();
            }}
            title={t('literature.ai.build_query')}
            type="button"
          >
            {state.busy === 'ai'
              ? <LoaderCircle className="spin" size={16} />
              : <Sparkles size={16} />}
            {' '}{state.busy === 'ai'
              ? t('literature.ai.generating')
              : t('literature.ai.assist')}
          </button>
          <button
            className="btn-gnosi btn-gnosi-primary"
            disabled={!state.query.trim() || !state.selectedSources.size || state.busy === 'search'}
            type="submit"
          >
            {state.busy === 'search'
              ? <LoaderCircle className="spin" size={16} />
              : <Search size={16} />}
            {' '}{t('literature.search.submit')}
          </button>
        </div>
        <div className="literature-search-toolbar">
          <button
            className="literature-link-button"
            onClick={() => { setters.setShowFilters((value) => !value); }}
            type="button"
          >
            <Filter size={14} /> {t('literature.search.filters')}{' '}
            {state.showFilters ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <button
            className="literature-link-button"
            onClick={() => { setters.setShowHistory((value) => !value); }}
            type="button"
          >
            <Clock3 size={14} /> {t('literature.search.history')}
          </button>
          {state.results.length > 1 && (
            <button
              className="literature-link-button"
              disabled={state.busy === 'rerank'}
              onClick={() => void actions.rerankResults()}
              type="button"
            >
              <Sparkles size={14} /> {t('literature.ai.rerank')}
            </button>
          )}
          {state.rerankAudit && (
            <span className="literature-search-state">
              {t('literature.ai.reranked_by', { model: rerankModel })}
            </span>
          )}
          {state.searchResult && (
            <span className={`literature-search-state is-${state.searchResult.state}`}>
              {t(`literature.search.state.${state.searchResult.state}`)} ·{' '}
              {t('literature.search.result_count', {
                count: state.searchResult.result_count ?? 0,
              })}
            </span>
          )}
          {state.searchResult && !TERMINAL_SEARCH_STATES.has(state.searchResult.state) && (
            <button
              className="literature-link-button is-danger"
              disabled={state.busy === 'cancel'}
              onClick={() => void actions.cancelSearch()}
              type="button"
            >
              <X size={14} /> {t('literature.search.cancel')}
            </button>
          )}
        </div>
        {state.showFilters && (
          <div className="literature-filters">
            <label>
              <span>{t('literature.search.date_from')}</span>
              <input
                onChange={(event) => { setters.setFilters((current) => ({
                  ...current,
                  date_from: event.target.value,
                })); }}
                type="date"
                value={state.filters.date_from}
              />
            </label>
            <label>
              <span>{t('literature.search.date_to')}</span>
              <input
                onChange={(event) => { setters.setFilters((current) => ({
                  ...current,
                  date_to: event.target.value,
                })); }}
                type="date"
                value={state.filters.date_to}
              />
            </label>
            <LanguageFilter
              onChange={(languages) => { setters.setFilters((current) => ({
                ...current,
                languages,
              })); }}
              t={t}
              value={state.filters.languages}
            />
            <label>
              <span>{t('literature.search.document_type')}</span>
              <select
                onChange={(event) => { setters.setFilters((current) => ({
                  ...current,
                  type: event.target.value,
                })); }}
                value={state.filters.type}
              >
                <option value="">{t('literature.search.any')}</option>
                <option value="journal-article">{t('literature.search.article')}</option>
                <option value="book">{t('literature.search.book')}</option>
                <option value="thesis">{t('literature.search.thesis')}</option>
                <option value="preprint">{t('literature.search.preprint')}</option>
              </select>
            </label>
            {([
              ['open_access', 'literature.search.open_access_only'],
              ['full_text', 'literature.search.full_text_only'],
              ['peer_reviewed', 'literature.search.peer_reviewed_only'],
            ] as const).map(([field, label]) => (
              <label className="is-check" key={field}>
                <input
                  checked={state.filters[field] === true}
                  onChange={(event) => { setters.setFilters((current) => ({
                    ...current,
                    [field]: event.target.checked ? true : null,
                  })); }}
                  type="checkbox"
                />
                {' '}{t(label)}
              </label>
            ))}
          </div>
        )}
        <SourcePicker
          onChange={actions.toggleSource}
          onConfigure={actions.openResourcesSettings}
          selected={state.selectedSources}
          sources={state.configuration.sources}
          statuses={state.searchResult?.source_status}
          t={t}
        />
        <details className="literature-source-queries">
          <summary>{t('literature.search.source_queries')}</summary>
          <p>{t('literature.search.source_queries_help')}</p>
          {state.configuration.sources
            .filter((source) => state.selectedSources.has(source.id))
            .map((source) => (
              <label key={source.id}>
                <span>{source.name}</span>
                <textarea
                  onChange={(event) => { setters.setSourceQueries((current) => ({
                    ...current,
                    [source.id]: event.target.value,
                  })); }}
                  placeholder={state.query || t('literature.search.query')}
                  rows={2}
                  value={state.sourceQueries[source.id] ?? ''}
                />
                <button
                  className="btn-gnosi-secondary"
                  disabled={!state.query.trim() || state.busy === `translate:${source.id}`}
                  onClick={() => void actions.runAiTranslation(source.id)}
                  type="button"
                >
                  <Sparkles size={14} /> {t('literature.ai.translate_source')}
                </button>
              </label>
            ))}
        </details>
      </form>
      <SearchAncillary
        controller={controller}
        language={language}
        queryInputRef={queryInputRef}
        t={t}
      />
    </section>
  );
}

export function SearchWorkspace(props: SearchWorkspaceProps) {
  const queryInputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <SearchPanel {...props} queryInputRef={queryInputRef} />
      <SearchResultsArea controller={props.controller} t={props.t} />
    </>
  );
}
