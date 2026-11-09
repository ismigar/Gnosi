import { useId, useMemo, useState } from 'react';
import { Check, LayoutDashboard, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useVaultContentSearch } from '../page-search/useVaultContentSearch';
import type { BookmarkPage } from './BookmarkForm';
import { bookmarkSearchText } from './bookmarks';
import { isDashboardPage } from '../records/model/pageKind';

interface Props {
  readonly pages: readonly BookmarkPage[];
  readonly selectedId: string;
  readonly selectedLabel?: string;
  readonly onlyDashboards?: boolean;
  readonly onSelect: (page: BookmarkPage) => void;
}

export function BookmarkPagePicker({ pages, selectedId, selectedLabel, onlyDashboards = false, onSelect }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(20);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const search = useVaultContentSearch(onlyDashboards ? '' : query);
  const results = useMemo<BookmarkPage[]>(() => {
    const words = bookmarkSearchText(query).trim().split(/\s+/u);
    const candidates = onlyDashboards ? pages.filter(isDashboardPage) : pages;
    const local = query.trim() ? candidates.filter(page => words.every(word => bookmarkSearchText(`${page.title} ${page.folder ?? ''}`).includes(word))) : candidates.slice(0, 8);
    return [...new Map([...local, ...search.results.map(hit => ({ id: hit.id, title: hit.title, folder: hit.path }))].map(page => [page.id, page])).values()];
  }, [pages, query, search.results, onlyDashboards]);
  const visible = results.slice(0, limit);
  const selected = pages.find(page => page.id === selectedId) ?? results.find(page => page.id === selectedId);
  return <div className="space-y-2">
    {selectedId ? <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm" role="status">
      <span className="flex items-center gap-2"><Check size={16} className="shrink-0 text-[var(--gnosi-primary)]" /><span className="break-words">{selected?.title || selectedLabel || t('bookmarks.selected_note', 'Selected note')}</span></span>
      {selected?.folder ? <span className="block pl-6 text-xs text-[var(--text-secondary)]">{selected.folder}</span> : null}
    </div> : null}
    <label className="block text-sm">
      <span className="mb-1 block">{onlyDashboards ? t('bookmarks.find_dashboard', 'Find a dashboard') : t('bookmarks.find_note', 'Find a note')}</span>
      <span className="flex items-center gap-2 rounded-lg border border-[var(--border-primary)] px-3">
        <Search size={16} className="shrink-0 text-[var(--text-secondary)]" />
        <input data-autofocus={!selectedId || undefined} className="min-w-0 flex-1 bg-transparent py-2 outline-none" value={query}
          placeholder={onlyDashboards ? t('bookmarks.find_dashboard_placeholder', 'Type a dashboard name…') : t('bookmarks.find_note_placeholder', 'Type a title or words from the note…')}
          role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={listId}
          aria-activedescendant={visible[activeIndex] ? `${listId}-${String(activeIndex)}` : undefined}
          onChange={event => { setQuery(event.target.value); setLimit(20); setActiveIndex(0); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const next = Math.max(0, Math.min(visible.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1)));
              setActiveIndex(next); document.getElementById(`${listId}-${String(next)}`)?.scrollIntoView({ block: 'nearest' });
            }
            if (event.key === 'Enter') { event.preventDefault(); const page = visible[activeIndex]; if (page) onSelect(page); }
          }} />
      </span>
    </label>
    <div id={listId} role="listbox" aria-label={t('bookmarks.page', 'Note')} className="max-h-44 overflow-y-auto rounded-lg border border-[var(--border-primary)]">
      {visible.map((page, index) => <button key={page.id} id={`${listId}-${String(index)}`} role="option" aria-selected={page.id === selectedId}
        type="button" tabIndex={-1} onMouseDown={event => { event.preventDefault(); }} onClick={() => { onSelect(page); }}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--bg-secondary)] ${index === activeIndex ? 'bg-[var(--bg-secondary)]' : ''}`}>
        {isDashboardPage(page) ? <LayoutDashboard size={16} className="shrink-0 text-[var(--text-secondary)]" /> : null}<span className="min-w-0 flex-1"><span className="block break-words">{page.title || t('common.untitled', 'Untitled')}</span>{page.folder ? <span className="block truncate text-xs text-[var(--text-secondary)]">{page.folder}</span> : null}</span>
        {page.id === selectedId ? <Check size={14} className="shrink-0 text-[var(--gnosi-primary)]" /> : null}
      </button>)}
      {!visible.length && !search.loading ? <p className="px-3 py-3 text-sm text-[var(--text-secondary)]">{onlyDashboards ? t('bookmarks.no_dashboards', 'No dashboards found. Try another name.') : t('bookmarks.no_notes', 'No notes found. Try another title.')}</p> : null}
    </div>
    {search.loading ? <p role="status" className="text-xs text-[var(--text-secondary)]">{t('bookmarks.searching', 'Searching the Vault…')}</p> : null}
    {search.error ? <p role="alert" className="text-xs text-[var(--gnosi-danger)]">{t('bookmarks.note_search_failed', 'The full Vault search failed. Loaded notes are still available.')} <button type="button" className="underline" onClick={search.retry}>{t('common.retry', 'Retry')}</button></p> : null}
    {visible.length < results.length || search.results.length < search.total ? <button type="button" className="text-sm text-[var(--gnosi-primary)]" disabled={search.loading} onClick={() => { setLimit(limit + 20); if (limit + 20 > results.length) search.loadMore(); }}>{t('globalsearch.load_more', 'More results')}</button> : null}
  </div>;
}
