import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Star, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { subscribeWindowEvent } from '../../shared/platform/browser-events';
import {
  defineStorageKey,
  jsonStorageCodec,
  readStorage,
  writeStorage,
} from '../../shared/platform/browser-storage';
import type { FilterValue } from '../../utils/vaultFilters';
import {
  openVaultNote,
  type MetadataValue,
} from '../../utils/vaultQuickNavigation';
import {
  GlobalSearchResults,
  type GlobalSearchResultItem,
} from './global-search-modal/GlobalSearchResults';
import {
  buildTagFieldsByTable,
  getSearchNoteTags,
  mergeGlobalSearchNotes,
  searchGlobalNotes,
} from './globalSearchUtils';


interface SavedSearch {
  readonly label: string;
  readonly query: string;
}


interface GlobalSearchMetadata extends Readonly<Record<string, FilterValue>> {
  readonly database_table_id?: FilterValue;
  readonly icon?: FilterValue;
  readonly table_id?: FilterValue;
  readonly tags?: FilterValue;
}


export interface GlobalSearchNote {
  readonly [key: string]: FilterValue | GlobalSearchMetadata;
  readonly folder?: FilterValue;
  readonly id?: string | null;
  readonly is_database?: boolean;
  readonly metadata?: GlobalSearchMetadata;
  readonly parent_id?: string | null;
  readonly path?: FilterValue;
  readonly resolved_table_id?: FilterValue;
  readonly title?: MetadataValue;
}


interface GlobalSearchTableProperty {
  readonly config?: Readonly<{ role?: FilterValue }>;
  readonly id?: FilterValue;
  readonly name?: FilterValue;
  readonly type?: string;
}


export interface GlobalSearchTable {
  readonly id?: FilterValue;
  readonly name?: FilterValue;
  readonly properties?: readonly (
    GlobalSearchTableProperty | null | undefined
  )[] | null;
}


export interface GlobalSearchModalProps {
  readonly aliasesById?: Readonly<Record<string, readonly string[]>> | null;
  readonly allNotes?: readonly GlobalSearchNote[];
  readonly globalIndex?: Readonly<Record<string, FilterValue>> | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onNoteSelect?: ((noteId: string) => void) | null;
  readonly tables?: readonly (GlobalSearchTable | null | undefined)[] | null;
}


interface OpenGlobalSearchModalProps {
  readonly aliasesById: Readonly<Record<string, readonly string[]>> | null;
  readonly allNotes: readonly GlobalSearchNote[];
  readonly globalIndex: Readonly<Record<string, FilterValue>> | null;
  readonly onClose: () => void;
  readonly onNoteSelect: ((noteId: string) => void) | null;
  readonly tables: readonly (GlobalSearchTable | null | undefined)[] | null;
}


function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}


function isUnknownRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function isSavedSearches(value: unknown): value is readonly SavedSearch[] {
  return isUnknownArray(value) && value.every((entry) => (
    isUnknownRecord(entry)
    && typeof entry.label === 'string'
    && typeof entry.query === 'string'
  ));
}


function isGlobalSearchNote(value: unknown): value is GlobalSearchNote {
  if (!isUnknownRecord(value)) return false;
  const { id } = value;
  return id === undefined || id === null || typeof id === 'string';
}


function displaySearchValue(value: FilterValue): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number'
    || typeof value === 'bigint'
    || typeof value === 'boolean'
  ) {
    const converted: unknown = Reflect.apply(String, undefined, [value]);
    return typeof converted === 'string' ? converted : '';
  }
  return '';
}


const SAVED_SEARCHES_KEY = defineStorageKey(
  'gnosi.savedSearches',
  jsonStorageCodec(isSavedSearches),
);


function loadSavedSearches(): SavedSearch[] {
  return [...(readStorage(SAVED_SEARCHES_KEY) ?? [])];
}


function persistSavedSearches(searches: readonly SavedSearch[]): void {
  writeStorage(SAVED_SEARCHES_KEY, searches.slice(0, 20));
}


function OpenGlobalSearchModal({
  aliasesById,
  allNotes,
  globalIndex,
  onClose,
  onNoteSelect,
  tables,
}: OpenGlobalSearchModalProps): React.JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [saved, setSaved] = useState(loadSavedSearches);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useModalKeyboard({
    containerRef: panelRef,
    isOpen: true,
    onClose,
    trapFocus: true,
  });

  const searchableNotes = useMemo(() => mergeGlobalSearchNotes(
    allNotes,
    globalIndex,
  ).filter(isGlobalSearchNote), [allNotes, globalIndex]);
  const tagFieldsByTable = useMemo(
    () => buildTagFieldsByTable(tables),
    [tables],
  );
  const filteredNotes = useMemo(() => searchGlobalNotes({
    aliasesById,
    notes: searchableNotes,
    query,
    tables,
  }), [aliasesById, query, searchableNotes, tables]);
  const getSourceDbTitle = useMemo(() => {
    const byId = new Map(
      searchableNotes
        .filter((note) => Boolean(note.id))
        .map((note) => [note.id ?? '', note]),
    );
    const tableNameById = new Map<string, string>();
    for (const table of tables ?? []) {
      const tableId = displaySearchValue(table?.id);
      const tableName = displaySearchValue(table?.name);
      if (tableId && tableName) tableNameById.set(tableId, tableName);
    }

    return (note: GlobalSearchNote): string | null => {
      const rawTableId = note.resolved_table_id
        || note.metadata?.table_id
        || note.metadata?.database_table_id;
      const tableId = displaySearchValue(rawTableId);
      if (tableId.toLowerCase() !== 'wiki') {
        const tableName = tableNameById.get(tableId);
        if (tableName) return tableName;
      }

      let current: GlobalSearchNote = note;
      for (let hop = 0; hop < 8; hop += 1) {
        const parentId = current.parent_id;
        if (!parentId) break;
        const parent = byId.get(parentId);
        if (!parent || parent.id === current.id) break;
        if (parent.is_database) {
          return displaySearchValue(parent.title) || null;
        }
        current = parent;
      }

      const folder = displaySearchValue(note.folder);
      if (/^BD\//i.test(folder)) {
        return folder.split('/').filter(Boolean).at(1) ?? null;
      }
      return null;
    };
  }, [searchableNotes, tables]);
  const resultItems = useMemo<GlobalSearchResultItem[]>(() => (
    filteredNotes.map((note) => ({
      folder: displaySearchValue(note.folder)
        || t('common.page_wiki', 'Page • Wiki'),
      icon: displaySearchValue(note.metadata?.icon),
      id: note.id ?? '',
      sourceDb: getSourceDbTitle(note),
      tags: getSearchNoteTags(note, tagFieldsByTable).slice(0, 3),
      title: displaySearchValue(note.title)
        || note.id
        || t('common.untitled', 'Untitled'),
    }))
  ), [filteredNotes, getSourceDbTitle, t, tagFieldsByTable]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => subscribeWindowEvent('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((previous) => (
        previous < filteredNotes.length - 1 ? previous + 1 : previous
      ));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((previous) => (previous > 0 ? previous - 1 : previous));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = filteredNotes.at(selectedIndex);
      if (selected) {
        openVaultNote(onNoteSelect, selected);
        onClose();
      }
    }
  }), [filteredNotes, onClose, onNoteSelect, selectedIndex]);

  useEffect(() => {
    const selected = listRef.current?.children.item(selectedIndex);
    if (selected instanceof HTMLElement) {
      selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  const updateQuery = (nextQuery: string): void => {
    setQuery(nextQuery);
    setSelectedIndex(0);
  };
  const saveCurrent = (): void => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || saved.some((entry) => (
      entry.query === normalizedQuery
    ))) return;
    const next = [
      { query: normalizedQuery, label: normalizedQuery },
      ...saved,
    ].slice(0, 20);
    setSaved(next);
    persistSavedSearches(next);
  };
  const removeSaved = (savedQuery: string): void => {
    const next = saved.filter((entry) => entry.query !== savedQuery);
    setSaved(next);
    persistSavedSearches(next);
  };
  const isSaved = saved.some((entry) => entry.query === query.trim());

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center pt-[15vh] px-4 sm:p-0">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity" />
      <div
        ref={panelRef}
        className="relative bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col font-sans border border-[var(--border-primary)]"
        role="dialog"
        aria-modal="true"
        aria-label={t('common.search', 'Search')}
      >
        <div className="flex items-center px-4 py-3 border-b border-[var(--border-primary)]">
          <Search size={20} className="text-[var(--text-tertiary)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              updateQuery(event.target.value);
            }}
            placeholder={t(
              'globalsearch.search_placeholder',
              'Search…  tag:a/b  path:Folder  title:text  /regex/',
            )}
            className="w-full bg-transparent border-none focus:ring-0 text-lg px-3 py-1 outline-none text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
          />
          {query.trim() ? (
            <button
              onClick={saveCurrent}
              title={isSaved
                ? t('globalsearch.search_saved', 'Search saved')
                : t('globalsearch.save_search', 'Save this search')}
              className={`shrink-0 mr-2 p-1 rounded hover:bg-[var(--bg-secondary)] ${isSaved ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'}`}
            >
              <Star size={16} fill={isSaved ? 'currentColor' : 'none'} />
            </button>
          ) : null}
          <kbd className="hidden sm:inline-flex items-center gap-1 text-[10px] font-medium text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-2 py-1 rounded border border-[var(--border-primary)]">
            ESC
          </kbd>
          <button
            type="button"
            onClick={onClose}
            className="ml-2 rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            aria-label={t('common.close', 'Close')}
          >
            <X size={16} />
          </button>
        </div>

        <div
          className="overflow-y-auto max-h-[60vh] custom-scrollbar"
          ref={listRef}
        >
          {query.trim() === '' ? (
            <div className="px-4 py-6">
              {saved.length > 0 ? (
                <>
                  <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                    {t('globalsearch.saved_searches_heading', 'Saved searches')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {saved.map((entry) => (
                      <span
                        key={entry.query}
                        className="group inline-flex items-center gap-1.5 rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] py-1 pl-3 pr-1.5 text-sm"
                      >
                        <button
                          className="text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)]"
                          onClick={() => {
                            updateQuery(entry.query);
                          }}
                        >
                          {entry.label}
                        </button>
                        <button
                          className="rounded-full p-0.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--gnosi-danger,#dc2626)]"
                          onClick={() => {
                            removeSaved(entry.query);
                          }}
                          title={t('globalsearch.remove_saved', 'Remove')}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <div className="py-6 text-center text-[var(--text-secondary)] text-sm">
                  {t(
                    'globalsearch.operators_hint',
                    'Search by title or with operators:',
                  )}{' '}
                  <code className="text-[var(--gnosi-primary)]">tag:</code>{' '}
                  <code className="text-[var(--gnosi-primary)]">path:</code>{' '}
                  <code className="text-[var(--gnosi-primary)]">title:</code>{' '}
                  <code className="text-[var(--gnosi-primary)]">/regex/</code>
                </div>
              )}
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="px-6 py-12 text-center text-[var(--text-secondary)] text-sm">
              {t(
                'globalsearch.no_results',
                'No results found for "{{query}}"',
                { query },
              )}
            </div>
          ) : (
            <GlobalSearchResults
              items={resultItems}
              onHover={(index) => {
                setSelectedIndex(index);
              }}
              onOpen={(index) => {
                const note = filteredNotes.at(index);
                if (note) {
                  openVaultNote(onNoteSelect, note);
                  onClose();
                }
              }}
              selectedIndex={selectedIndex}
            />
          )}
        </div>
      </div>
    </div>
  );
}


export function GlobalSearchModal({
  aliasesById = {},
  allNotes = [],
  globalIndex = {},
  isOpen,
  onClose,
  onNoteSelect = null,
  tables = [],
}: GlobalSearchModalProps): React.JSX.Element | null {
  if (!isOpen) return null;
  return (
    <OpenGlobalSearchModal
      aliasesById={aliasesById}
      allNotes={allNotes}
      globalIndex={globalIndex}
      onClose={onClose}
      onNoteSelect={onNoteSelect}
      tables={tables}
    />
  );
}
