import {
  Check,
  ExternalLink,
  Eye,
  FilePlus2,
  X,
} from 'lucide-react';

import { authorLine } from './literatureModel';
import type { LiteratureWorkView, Translate } from './literatureTypes';

interface WorkPreviewProps {
  readonly onClose: () => void;
  readonly onImport: (work: LiteratureWorkView) => void;
  readonly t: Translate;
  readonly work: LiteratureWorkView | null;
}

function conflictValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function WorkPreview({ onClose, onImport, t, work }: WorkPreviewProps) {
  if (!work) return null;
  const conflicts = Object.entries(work.conflicts ?? {});
  const identifiers = [
    work.identifiers?.doi && `DOI ${work.identifiers.doi}`,
    work.identifiers?.pmid && `PMID ${work.identifiers.pmid}`,
    work.identifiers?.arxiv && `arXiv ${work.identifiers.arxiv}`,
    ...(work.identifiers?.isbn13 ?? []),
  ].filter(Boolean).join(' · ') || '—';
  return (
    <div
      aria-labelledby="literature-preview-title"
      aria-modal="true"
      className="literature-preview-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <aside className="literature-preview">
        <header>
          <div>
            <span>{t('literature.preview.eyebrow')}</span>
            <h2 id="literature-preview-title">{work.title}</h2>
          </div>
          <button
            aria-label={t('common.close')}
            className="literature-icon-button"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>
        <div className="literature-preview__body">
          <dl className="literature-metadata-grid">
            <div><dt>{t('literature.result.authors')}</dt><dd>{authorLine(work) || '—'}</dd></div>
            <div><dt>{t('literature.result.year')}</dt><dd>{work.year || '—'}</dd></div>
            <div>
              <dt>{t('literature.result.publication')}</dt>
              <dd>{work.publication?.container_title ?? work.publication?.publisher ?? '—'}</dd>
            </div>
            <div><dt>{t('literature.result.language')}</dt><dd>{work.language || '—'}</dd></div>
            <div><dt>{t('literature.result.identifiers')}</dt><dd>{identifiers}</dd></div>
            <div>
              <dt>{t('literature.result.open_access')}</dt>
              <dd>{work.open_access?.is_oa === true
                ? t('common.yes')
                : work.open_access?.is_oa === false
                  ? t('common.no')
                  : t('literature.result.unknown')}</dd>
            </div>
          </dl>
          <section>
            <h3>{t('literature.preview.abstract')}</h3>
            <p>{work.abstract || t('literature.preview.no_abstract')}</p>
          </section>
          <section>
            <h3>{t('literature.preview.field_provenance')}</h3>
            <div className="literature-provenance">
              {Object.entries(work.provenance ?? {}).map(([field, providers]) => (
                <div key={field}><strong>{field}</strong><span>{providers.join(', ')}</span></div>
              ))}
            </div>
          </section>
          {conflicts.length > 0 && (
            <section>
              <h3>{t('literature.preview.conflicts')}</h3>
              {conflicts.map(([field, variants]) => (
                <div className="literature-conflict" key={field}>
                  <strong>{field}</strong>
                  {variants.map((variant, index) => (
                    <p key={`${variant.provider}-${index.toString()}`}>
                      <span>{variant.provider}</span>{' '}
                      {conflictValue(variant.value)}
                    </p>
                  ))}
                </div>
              ))}
            </section>
          )}
          <section>
            <h3>{t('literature.preview.locations')}</h3>
            <div className="literature-locations">
              {(work.locations ?? []).map((location, index) => (
                <a
                  href={location.landing_page_url ?? location.url}
                  key={`${location.url ?? ''}-${index.toString()}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink size={13} />
                  {' '}{location.license ?? location.landing_page_url ?? location.url}
                </a>
              ))}
            </div>
          </section>
          <section>
            <h3>{t('literature.preview.original_sources')}</h3>
            <div className="literature-locations">
              {(work.sources ?? []).map((source, index) => (
                <a
                  href={source.url ?? '#'}
                  key={`${source.provider}-${source.provider_id}-${index.toString()}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink size={13} /> {source.provider} · {source.provider_id}
                </a>
              ))}
            </div>
          </section>
        </div>
        <footer>
          <button className="btn-gnosi-secondary" onClick={onClose} type="button">
            {t('common.close')}
          </button>
          <button
            className="btn-gnosi btn-gnosi-primary"
            disabled={work.in_resources}
            onClick={() => { onImport(work); }}
            type="button"
          >
            <FilePlus2 size={15} />
            {' '}{work.in_resources
              ? t('literature.result.already_added')
              : t('literature.result.add')}
          </button>
        </footer>
      </aside>
    </div>
  );
}

interface ResultCardProps {
  readonly onImport: () => void;
  readonly onPreview: () => void;
  readonly onSelect: (checked: boolean) => void;
  readonly selected: boolean;
  readonly t: Translate;
  readonly work: LiteratureWorkView;
}

export function ResultCard({
  onImport,
  onPreview,
  onSelect,
  selected,
  t,
  work,
}: ResultCardProps) {
  const citations = Object.entries(work.metrics?.citations ?? {});
  return (
    <article className={`literature-result ${selected ? 'is-selected' : ''}`}>
      <label className="literature-result__select">
        <input
          checked={selected}
          onChange={(event) => { onSelect(event.target.checked); }}
          type="checkbox"
        />
        <span className="sr-only">{t('literature.result.select', { title: work.title })}</span>
      </label>
      <div className="literature-result__content">
        <div className="literature-result__badges">
          {(work.sources ?? []).map((source) => (
            <span key={`${source.provider}-${source.provider_id}`}>{source.provider}</span>
          ))}
          {(work.sources ?? []).length > 1 && (
            <strong>{t('literature.result.occurrences', { count: work.sources?.length })}</strong>
          )}
          {work.open_access?.is_oa && <span className="is-oa">{t('literature.result.oa')}</span>}
          {work.in_resources && (
            <span className="is-added"><Check size={11} /> {t('literature.result.already_added')}</span>
          )}
          {work.semantic_rank && (
            <span>{t('literature.result.semantic_rank', {
              original: work.original_rank,
              rank: work.semantic_rank,
            })}</span>
          )}
        </div>
        <h3>{work.title}</h3>
        <p className="literature-result__authors">
          {authorLine(work) || t('literature.result.unknown_author')}
          {' '}{work.year ? `· ${String(work.year)}` : ''}
        </p>
        <p className="literature-result__publication">
          {work.publication?.container_title ?? work.publication?.publisher ?? ''}
        </p>
        {work.abstract && <p className="literature-result__abstract">{work.abstract}</p>}
        <div className="literature-result__meta">
          {work.identifiers?.doi && <span>DOI {work.identifiers.doi}</span>}
          {citations.map(([provider, count]) => (
            <span key={provider}>{t('literature.result.citations', { count, provider })}</span>
          ))}
          {(work.possible_duplicates ?? []).length > 0 && (
            <span className="is-warning">
              {t('literature.result.possible_duplicates', {
                count: work.possible_duplicates?.length,
              })}
            </span>
          )}
        </div>
      </div>
      <div className="literature-result__actions">
        <button className="btn-gnosi-secondary" onClick={onPreview} type="button">
          <Eye size={14} /> {t('literature.result.view')}
        </button>
        <button
          className="btn-gnosi btn-gnosi-primary"
          disabled={work.in_resources}
          onClick={onImport}
          type="button"
        >
          <FilePlus2 size={14} />
          {' '}{work.in_resources
            ? t('literature.result.already_added')
            : t('literature.result.add')}
        </button>
      </div>
    </article>
  );
}
