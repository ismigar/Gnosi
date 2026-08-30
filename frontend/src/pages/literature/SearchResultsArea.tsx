import {
  ArrowLeft,
  BookOpenCheck,
  ChevronRight,
  CircleAlert,
  FilePlus2,
  LibraryBig,
  NotebookTabs,
  Search,
} from 'lucide-react';

import { SEARCH_PAGE_SIZE } from './literatureModel';
import { ResultCard, WorkPreview } from './SearchResults';
import type { LiteratureSearchController } from './useLiteratureSearch';
import type { Translate } from './literatureTypes';

interface SearchResultsAreaProps {
  readonly controller: LiteratureSearchController;
  readonly t: Translate;
}

export function SearchResultsArea({ controller, t }: SearchResultsAreaProps) {
  const { actions, setters, state } = controller;
  return (
    <>
      {state.error && (
        <div className="literature-alert" role="alert">
          <CircleAlert size={16} /> {state.error}
        </div>
      )}
      {(state.searchResult?.errors?.length ?? 0) > 0 && (
        <details className="literature-source-errors">
          <summary>{t('literature.search.partial_errors', {
            count: state.searchResult?.errors?.length,
          })}</summary>
          {state.searchResult?.errors?.map((item, index) => (
            <p key={`${item.source_id ?? ''}-${index.toString()}`}>
              <strong>{item.source_id}</strong> {item.message}
            </p>
          ))}
        </details>
      )}
      {state.searchResult
        && Object.keys(state.searchResult.exact_queries ?? {}).length > 0 && (
        <details className="literature-query-audit">
          <summary>{t('literature.search.audit_title')}</summary>
          <div className="literature-query-audit__counts">
            <span>{t('literature.search.audit_raw', {
              count: state.searchResult.counts?.raw_occurrences ?? 0,
            })}</span>
            <span>{t('literature.search.audit_unique', {
              count: state.searchResult.counts?.unique_works ?? 0,
            })}</span>
            <span>{t('literature.search.audit_duplicates', {
              count: state.searchResult.counts?.duplicates_removed ?? 0,
            })}</span>
            <span>{t('literature.search.audit_possible', {
              count: state.searchResult.counts?.possible_duplicate_pairs ?? 0,
            })}</span>
            <span>{t('literature.search.audit_ai', {
              count: state.searchResult.ai_audits?.length ?? 0,
            })}</span>
          </div>
          {Object.entries(state.searchResult.exact_queries ?? {}).map(([sourceId, audit]) => (
            <article key={sourceId}>
              <header>
                <strong>{audit.source_name ?? sourceId}</strong>
                <small>v{audit.connector_version ?? 1}</small>
              </header>
              <code>{typeof audit.provider_syntax === 'string'
                ? audit.provider_syntax
                : JSON.stringify(audit.provider_syntax)}</code>
              <details>
                <summary>{t('literature.search.audit_requests', {
                  count: audit.requests?.length ?? 0,
                })}</summary>
                <pre>{JSON.stringify(audit.requests ?? [], null, 2)}</pre>
              </details>
            </article>
          ))}
          {(state.searchResult.ai_audits?.length ?? 0) > 0 && (
            <article>
              <header><strong>{t('literature.search.audit_ai_operations')}</strong></header>
              <pre>{JSON.stringify(state.searchResult.ai_audits, null, 2)}</pre>
            </article>
          )}
        </details>
      )}
      {state.selectedWorks.length > 0 && (
        <div className="literature-bulk-bar">
          <strong>{t('literature.bulk.selected', { count: state.selectedWorks.length })}</strong>
          <button
            className="btn-gnosi-secondary"
            disabled={state.busy === 'import'}
            onClick={() => void actions.importWorks(state.selectedWorks)}
            type="button"
          >
            <FilePlus2 size={14} /> {t('literature.bulk.add_resources')}
          </button>
          <button
            className="btn-gnosi btn-gnosi-primary"
            disabled={state.busy === 'notebook'}
            onClick={() => void actions.importWorks(state.selectedWorks, true)}
            type="button"
          >
            <NotebookTabs size={14} /> {t('literature.bulk.send_notebook')}
          </button>
          <button
            className="btn-gnosi-secondary"
            onClick={() => { setters.setTab('reviews'); }}
            type="button"
          >
            <BookOpenCheck size={14} /> {t('literature.bulk.add_review')}
          </button>
        </div>
      )}
      <section aria-live="polite" className="literature-results">
        {!state.searchResult ? (
          <div className="literature-empty">
            <LibraryBig size={38} />
            <h2>{t('literature.empty.title')}</h2>
            <p>{t('literature.empty.help')}</p>
          </div>
        ) : state.results.length === 0 && state.searchResult.state === 'completed' ? (
          <div className="literature-empty">
            <Search size={34} />
            <h2>{t('literature.empty.no_results')}</h2>
            <p>{t('literature.empty.no_results_help')}</p>
          </div>
        ) : state.results.map((work) => (
          <ResultCard
            key={work.id}
            onImport={() => void actions.importWorks([work])}
            onPreview={() => { setters.setPreview(work); }}
            onSelect={(checked) => { actions.toggleWork(work, checked); }}
            selected={state.selectedIds.has(work.id)}
            t={t}
            work={work}
          />
        ))}
      </section>
      {state.searchResult
        && (state.searchResult.result_count ?? 0) > SEARCH_PAGE_SIZE && (
        <nav aria-label={t('literature.search.pagination')} className="literature-pagination">
          <button
            className="btn-gnosi-secondary"
            disabled={state.resultOffset === 0}
            onClick={() => void actions.changePage(state.resultOffset - SEARCH_PAGE_SIZE)}
            type="button"
          >
            <ArrowLeft size={14} /> {t('common.previous')}
          </button>
          <span>{t('literature.search.page_range', {
            from: state.resultOffset + 1,
            to: Math.min(
              state.resultOffset + SEARCH_PAGE_SIZE,
              state.searchResult.result_count ?? 0,
            ),
            total: state.searchResult.result_count ?? 0,
          })}</span>
          <button
            className="btn-gnosi-secondary"
            disabled={state.resultOffset + SEARCH_PAGE_SIZE >= (state.searchResult.result_count ?? 0)}
            onClick={() => void actions.changePage(state.resultOffset + SEARCH_PAGE_SIZE)}
            type="button"
          >
            {t('common.next')} <ChevronRight size={14} />
          </button>
        </nav>
      )}
      <WorkPreview
        onClose={() => { setters.setPreview(null); }}
        onImport={(work) => void actions.importWorks([work])}
        t={t}
        work={state.preview}
      />
    </>
  );
}
