import { useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  Search,
  Settings,
  X,
} from 'lucide-react';

import type { LiteratureSource } from '../../../shared/api/literature-resources';
import { aiText, LANGUAGE_OPTIONS } from './literatureModel';
import type {
  LiteratureAiResultView,
  SearchSourceStatus,
  Translate,
} from './literatureTypes';

interface SourcePickerProps {
  readonly onChange: (sourceId: string, checked: boolean) => void;
  readonly onConfigure: () => void;
  readonly selected: ReadonlySet<string>;
  readonly sources: readonly LiteratureSource[];
  readonly statuses?: Readonly<Record<string, SearchSourceStatus>>;
  readonly t: Translate;
}

function sourceAvailabilityLabel(source: LiteratureSource, t: Translate): string {
  if (source.available) return '';
  if (source.requires_contact) return t('literature.search.source_requires_contact');
  if (source.credential_status === 'missing') {
    return t('literature.search.source_requires_credentials');
  }
  if (source.kind === 'oai') return t('literature.search.source_requires_index');
  return t('literature.search.source_unavailable');
}

export function SourcePicker({
  onChange,
  onConfigure,
  selected,
  sources,
  statuses,
  t,
}: SourcePickerProps) {
  const [expanded, setExpanded] = useState(false);
  const automated = sources.filter((source) => source.automated && !source.hidden);
  const visible = expanded ? automated : automated.slice(0, 12);
  return (
    <div className="literature-source-picker">
      <div className="literature-source-picker__header">
        <strong>{t('literature.search.sources')}</strong>
        <span>{t('literature.search.sources_selected', { count: selected.size })}</span>
      </div>
      <div className="literature-source-picker__items">
        {visible.map((source) => {
          const status = statuses?.[source.id];
          const className = [
            'literature-source-chip',
            selected.has(source.id) ? 'is-selected' : '',
            !source.available ? 'is-unavailable' : '',
          ].filter(Boolean).join(' ');
          return (
            <label
              className={className}
              key={source.id}
              title={sourceAvailabilityLabel(source, t)}
            >
              <input
                checked={selected.has(source.id)}
                disabled={!source.available}
                onChange={(event) => { onChange(source.id, event.target.checked); }}
                type="checkbox"
              />
              <span>{source.name}</span>
              {status?.state === 'running' && <LoaderCircle className="spin" size={12} />}
              {status?.state === 'completed' && <small>{status.count}</small>}
              {status?.state === 'failed' && <CircleAlert size={12} />}
            </label>
          );
        })}
      </div>
      <div className="literature-source-picker__actions">
        {automated.length > 12 && (
          <button
            className="literature-link-button"
            onClick={() => { setExpanded((value) => !value); }}
            type="button"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {' '}
            {expanded
              ? t('literature.search.show_less_sources')
              : t('literature.search.show_all_sources')}
          </button>
        )}
        {automated.some((source) => !source.available) && (
          <button
            className="btn-gnosi btn-gnosi-secondary literature-source-picker__configure-button"
            onClick={onConfigure}
            type="button"
          >
            <Settings size={14} /> {t('literature.search.configure_sources')}
          </button>
        )}
      </div>
    </div>
  );
}

interface LanguageFilterProps {
  readonly onChange: (languages: string[]) => void;
  readonly t: Translate;
  readonly value: readonly string[];
}

export function LanguageFilter({ onChange, t, value }: LanguageFilterProps) {
  const selected = new Set(value);
  const summary = selected.size
    ? LANGUAGE_OPTIONS.filter(([code]) => selected.has(code))
        .map(([, label]) => label).join(', ')
    : t('literature.search.any');
  return (
    <div className="literature-language-filter">
      <span>{t('literature.search.language')}</span>
      <details>
        <summary>{summary}</summary>
        <div>
          {LANGUAGE_OPTIONS.map(([code, label]) => (
            <label key={code}>
              <input
                checked={selected.has(code)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(code);
                  else next.delete(code);
                  onChange(Array.from(next));
                }}
                type="checkbox"
              />
              {' '}{label}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

interface AiProposalProps {
  readonly language: string;
  readonly onClose: () => void;
  readonly onSearch: (query: string) => void;
  readonly onUseQuery: (query: string) => void;
  readonly onUseSourceQuery: (query: string) => void;
  readonly proposal: LiteratureAiResultView;
  readonly t: Translate;
}

export function AiProposal({
  language,
  onClose,
  onSearch,
  onUseQuery,
  onUseSourceQuery,
  proposal,
  t,
}: AiProposalProps) {
  const result = proposal.result;
  const initialQuery = result.boolean_query ?? result.translated_query ?? '';
  const [editableQuery, setEditableQuery] = useState(initialQuery);
  const concepts = Object.entries(result.concepts ?? {})
    .filter(([, value]) => aiText(value, language));
  const synonyms = Object.entries(result.synonyms ?? {})
    .filter(([, value]) => aiText(value, language));
  const cautions = Array.isArray(result.cautions)
    ? result.cautions
    : result.cautions ? [result.cautions] : result.warnings ?? [];
  const isTranslation = proposal.operation === 'translate_query';
  const title = isTranslation
    ? t('literature.ai.translation_proposal')
    : t('literature.ai.proposal');

  return (
    <section aria-label={title} className="literature-ai-proposal">
      <header>
        <Bot size={16} /><strong>{title}</strong><span>{proposal.audit.model}</span>
        <button aria-label={t('common.close')} onClick={onClose} type="button">
          <X size={14} />
        </button>
      </header>
      {concepts.length > 0 && (
        <dl className="literature-ai-proposal__concepts">
          {concepts.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{aiText(value, language)}</dd></div>
          ))}
        </dl>
      )}
      {synonyms.length > 0 && (
        <div className="literature-ai-proposal__synonyms">
          <strong>{t('literature.ai.synonyms')}</strong>
          {synonyms.map(([label, value]) => (
            <p key={label}><span>{label}</span>{aiText(value, language)}</p>
          ))}
        </div>
      )}
      {editableQuery && (
        <label className="literature-ai-proposal__query">
          <span>{isTranslation
            ? t('literature.ai.translated_query')
            : t('literature.ai.boolean_query')}</span>
          <textarea
            onChange={(event) => { setEditableQuery(event.target.value); }}
            rows={3}
            value={editableQuery}
          />
        </label>
      )}
      {cautions.length > 0 && (
        <ul className="literature-ai-proposal__cautions">
          {cautions.map((caution, index) => (
            <li key={index}>{aiText(caution, language)}</li>
          ))}
        </ul>
      )}
      {editableQuery && (isTranslation ? (
        <button
          className="btn-gnosi-secondary"
          onClick={() => { onUseSourceQuery(editableQuery); }}
          type="button"
        >
          {t('literature.ai.use_source_query', { source: result.source_id })}
        </button>
      ) : (
        <div className="literature-ai-proposal__actions">
          <button
            className="btn-gnosi-secondary"
            onClick={() => { onUseQuery(editableQuery); }}
            type="button"
          >
            {t('literature.ai.use_query')}
          </button>
          <button
            className="btn-gnosi btn-gnosi-primary"
            onClick={() => { onSearch(editableQuery); }}
            type="button"
          >
            <Search size={14} /> {t('literature.ai.search_with_query')}
          </button>
        </div>
      ))}
      <details className="literature-ai-proposal__technical">
        <summary>{t('literature.ai.technical_details')}</summary>
        <pre>{JSON.stringify(result, null, 2)}</pre>
      </details>
      <small>{t('literature.ai.human_control')}</small>
    </section>
  );
}
