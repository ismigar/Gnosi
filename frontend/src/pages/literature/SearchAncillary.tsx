import {
  Eye,
  FilePlus2,
  LoaderCircle,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { RefObject } from 'react';

import { authorLine } from './literatureModel';
import { AiProposal } from './SearchControls';
import type { LiteratureSearchController } from './useLiteratureSearch';
import type { ManualKind, Translate } from './literatureTypes';

interface SearchAncillaryProps {
  readonly controller: LiteratureSearchController;
  readonly language: string;
  readonly queryInputRef: RefObject<HTMLInputElement | null>;
  readonly t: Translate;
}

export function SearchAncillary({
  controller,
  language,
  queryInputRef,
  t,
}: SearchAncillaryProps) {
  const { actions, setters, state } = controller;
  const manualWork = state.manualWork;
  return (
    <>
      {state.showHistory && (
        <div className="literature-search-history">
          <header>
            <strong>{t('literature.search.history')}</strong>
            <button
              aria-label={t('literature.search.refresh_history')}
              className="literature-icon-button"
              onClick={() => void actions.loadSearchHistory()}
              type="button"
            >
              <RefreshCw size={14} />
            </button>
          </header>
          {state.searchHistory.length === 0 ? <p>{t('literature.search.no_history')}</p> : (
            state.searchHistory.map((item) => (
              <button
                className={state.searchResult?.id === item.id ? 'is-active' : ''}
                key={item.id}
                onClick={() => void actions.openSearch(item.id)}
                type="button"
              >
                <span>{item.query}</span>
                <small>
                  {t(`literature.search.state.${item.state}`)} ·{' '}
                  {t('literature.search.result_count', { count: item.result_count ?? 0 })}
                </small>
              </button>
            ))
          )}
        </div>
      )}
      {state.aiProposal && (
        <AiProposal
          language={language}
          onClose={() => { setters.setAiProposal(null); }}
          onSearch={(nextQuery) => {
            setters.setQuery(nextQuery);
            setters.setSourceQueries({});
            void actions.executeSearch(nextQuery);
          }}
          onUseQuery={(nextQuery) => {
            setters.setQuery(nextQuery);
            setters.setSourceQueries({});
            setters.setAiProposal(null);
            queryInputRef.current?.focus();
          }}
          onUseSourceQuery={(nextQuery) => { setters.setSourceQueries((current) => ({
            ...current,
            [state.aiProposal?.result.source_id ?? '']: nextQuery,
          })); }}
          proposal={state.aiProposal}
          t={t}
        />
      )}
      <details className="literature-manual-capture">
        <summary>{t('literature.manual.title')}</summary>
        <p>{t('literature.manual.help')}</p>
        <form onSubmit={(event) => void actions.captureManualWork(event)}>
          <select
            aria-label={t('literature.manual.kind')}
            onChange={(event) => { setters.setManualKind(event.target.value as ManualKind); }}
            value={state.manualKind}
          >
            {(['auto', 'doi', 'pmid', 'arxiv', 'isbn', 'url'] as const).map((kind) => (
              <option key={kind} value={kind}>{t(`literature.manual.kind_${kind}`)}</option>
            ))}
          </select>
          <input
            aria-label={t('literature.manual.value')}
            onChange={(event) => { setters.setManualValue(event.target.value); }}
            placeholder={t('literature.manual.placeholder')}
            value={state.manualValue}
          />
          <button
            className="btn-gnosi-secondary"
            disabled={!state.manualValue.trim() || state.busy === 'manual'}
            type="submit"
          >
            {state.busy === 'manual'
              ? <LoaderCircle className="spin" size={14} />
              : <Plus size={14} />}
            {' '}{t('literature.manual.preview')}
          </button>
        </form>
        {manualWork && (
          <article>
            <div>
              <strong>{manualWork.title}</strong>
              <small>
                {authorLine(manualWork)} {manualWork.year
                  ? `· ${String(manualWork.year)}`
                  : ''}
              </small>
            </div>
            <div>
              <button
                className="btn-gnosi-secondary"
                onClick={() => { setters.setPreview(manualWork); }}
                type="button"
              >
                <Eye size={14} /> {t('literature.result.view')}
              </button>
              <button
                className="btn-gnosi btn-gnosi-primary"
                disabled={manualWork.in_resources}
                onClick={() => void actions.importWorks([manualWork])}
                type="button"
              >
                <FilePlus2 size={14} />
                {' '}{manualWork.in_resources
                  ? t('literature.result.already_added')
                  : t('literature.result.add')}
              </button>
            </div>
          </article>
        )}
      </details>
    </>
  );
}
