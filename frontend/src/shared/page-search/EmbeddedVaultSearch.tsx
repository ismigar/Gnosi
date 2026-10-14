import { useTranslation } from 'react-i18next';

import { useVaultContentSearch } from './useVaultContentSearch';

export interface EmbeddedVaultSearchProps {
  readonly query: string;
  readonly onOpenPage?: (id: string) => void;
  readonly vaultId?: string | null;
}

export function EmbeddedVaultSearch({ query, onOpenPage, vaultId }: EmbeddedVaultSearchProps): React.JSX.Element {
  const { t } = useTranslation();
  const search = useVaultContentSearch(query, vaultId);
  return (
    <section className="my-3 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3" aria-label={t('globalsearch.embedded', 'Search results')}>
      <code className="text-xs text-[var(--text-secondary)]">{query}</code>
      {search.error ? <p role="alert">{t(search.error === 'query' ? 'globalsearch.invalid_query' : 'globalsearch.search_failed')}</p> : null}
      {search.loading ? <p role="status">{t('globalsearch.searching', 'Searching notes…')}</p> : null}
      <ul className="my-2 space-y-2">
        {search.results.map((hit) => (
          <li key={hit.id}>
            <button type="button" className="text-[var(--gnosi-primary)] hover:underline" onClick={() => { onOpenPage?.(hit.id); }}>{hit.title}</button>
            <p className="whitespace-pre-wrap text-xs text-[var(--text-secondary)]">{hit.excerpt}</p>
          </li>
        ))}
      </ul>
      {!search.loading && !search.error && search.total === 0 ? <p>{t('globalsearch.no_results', { query })}</p> : null}
      {search.results.length < search.total ? <button type="button" disabled={search.loading} onClick={search.loadMore} className="text-sm text-[var(--gnosi-primary)]">{t('globalsearch.load_more', 'More results')}</button> : null}
    </section>
  );
}
