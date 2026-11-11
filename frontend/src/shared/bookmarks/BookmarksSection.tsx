import { lazy, Suspense, useId, useRef, useState } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Bookmark, ChevronDown, ChevronRight, Ellipsis, Plus, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useActiveVaultId } from '../hooks/useActiveVaultId';
import { useRequestContext } from '../hooks/useRequestContext';
import { EmbeddedVaultSearch } from '../page-search/EmbeddedVaultSearch';
import { RefreshButton } from '../ui/actions/RefreshButton';
import { BookmarkForm, type BookmarkPage } from './BookmarkForm';
import { bookmarkSearchText } from './bookmarks';
import { BookmarkRow } from './BookmarkRows';
import { currentBookmarkRoute } from './bookmark-routes';
import { dragBookmark, groupedBookmarks } from './bookmark-order';
import { bookmarkLabel, bookmarkScope, isBookmark, moveBookmark, normalizeBookmarkDestination, type BookmarkSortMode, type VaultBookmark } from './bookmarks';
import { useBookmarks } from './useBookmarks';

const VaultMarkdown = lazy(() => import('../editor/VaultMarkdown'));
interface BookmarksSectionProps {
  readonly onPageSelect: (id: string) => unknown;
  readonly pages: readonly BookmarkPage[];
  readonly activePageId?: string | null;
  readonly expanded?: boolean;
  readonly onExpandedChange?: (expanded: boolean) => void;
}

function ScopedBookmarks({ onPageSelect, pages, activePageId, expanded: controlledExpanded, onExpandedChange }: BookmarksSectionProps) {
  const { t } = useTranslation();
  const bookmarks = useBookmarks();
  const { entries, sortMode, isReady, isPending, error } = bookmarks;
  const [localExpanded, setLocalExpanded] = useState(true);
  const expanded = controlledExpanded ?? localExpanded;
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsId = useId();
  const [draft, setDraft] = useState<VaultBookmark | null>(null);
  const draftId = draft?.id;
  const [query, setQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = entries.find((entry) => entry.id === previewId);
  const [actionError, setActionError] = useState<'invalid' | 'save' | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const disabled = !isReady || isPending || busy;
  const grouped = groupedBookmarks(entries, sortMode);
  const needle = bookmarkSearchText(query).trim();
  const visibleGroups = grouped.map(({ group, entries: members }) => ({ group, entries: members.filter(entry => bookmarkSearchText(`${entry.label} ${entry.group} ${pages.find(page => page.id === entry.target)?.title ?? ''}`).includes(needle)) })).filter(({ entries: members }) => members.length > 0);
  const currentView = currentBookmarkRoute();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const persist = async (operation: () => Promise<unknown>, closeDraft = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setActionError(null);
    try { await operation(); if (closeDraft) setDraft(null); }
    catch { setActionError('save'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const create = (group = '') => {
    const current = pages.find((page) => page.id === activePageId);
    setActionError(null); setActionsOpen(false); setLocalExpanded(true); onExpandedChange?.(true);
    setDraft({ id: crypto.randomUUID(), kind: 'page', label: bookmarkLabel(current?.title ?? '', current?.id), target: current?.id ?? '', group });
  };
  const createView = () => {
    if (!currentView) return;
    const current = pages.find((page) => page.id === activePageId);
    const label = current?.title || document.title.replace(/\s*[·|—]\s*Gnosi.*$/u, '').trim() || t('bookmarks.route', 'Gnosi view');
    setActionError(null); setActionsOpen(false); setLocalExpanded(true); onExpandedChange?.(true);
    setDraft(normalizeBookmarkDestination({ id: crypto.randomUUID(), kind: 'route', label: bookmarkLabel(label), target: currentView, group: '' }));
  };
  const save = () => {
    if (!draft || disabled) return;
    if (!isBookmark(draft)) { setActionError('invalid'); return; }
    void persist(() => bookmarks.save(normalizeBookmarkDestination({ ...draft, label: draft.label.trim(), group: draft.group.trim() })), true);
  };
  const move = (direction: -1 | 1) => {
    if (draft && !disabled && sortMode === 'manual') void persist(() => bookmarks.reorder(moveBookmark(entries, draft.id, direction).map((entry) => entry.id)));
  };
  const drag = ({ active, over }: DragEndEvent) => {
    if (disabled || sortMode !== 'manual' || !over) return;
    const ids = dragBookmark(entries, String(active.id), String(over.id));
    if (ids) void persist(() => bookmarks.reorder(ids));
  };
  const draftGroup = entries.filter((entry) => entry.group === draft?.group);
  const draftIndex = draftGroup.findIndex((entry) => entry.id === draft?.id);
  const existingDraft = entries.some((entry) => entry.id === draftId);
  const alert = error || actionError ? <p role="alert" className="mt-2 text-[var(--gnosi-danger)]">{actionError === 'invalid' ? t('bookmarks.invalid_target', 'Check the name and destination of the bookmark.') : actionError === 'save' ? t('bookmarks.save_failed', 'The change could not be saved. Your draft has been kept; try again.') : t('bookmarks.sync_failed', 'Bookmarks could not be synchronized. Refresh to try again.')}</p> : null;
  const sameGroup = entries.find(entry => entry.id === draftId)?.group === draft?.group;
  const draftForm = draft && <BookmarkForm key={draft.id} draft={draft} pages={pages} activePageId={activePageId} groups={grouped.map(({ group }) => group)} disabled={disabled} error={alert}
        existing={existingDraft} canMoveUp={sameGroup && sortMode === 'manual' && draftIndex > 0} canMoveDown={sameGroup && sortMode === 'manual' && draftIndex >= 0 && draftIndex < draftGroup.length - 1}
        onChange={setDraft} onSave={save} onCancel={() => { setDraft(null); setActionError(null); }} onMove={move}
        onRemove={() => { if (!disabled) void persist(async () => { await bookmarks.remove(draft.id); setPreviewId(null); }, true); }} />
  ;
  return <section className="px-3 my-3 text-xs" aria-label={t('bookmarks.title', 'Bookmarks')} aria-busy={isPending || busy}>
    <div className="flex items-center gap-1">
      <button type="button" className="gnosi-sidebar-section-title flex flex-1 items-center gap-1 text-left" aria-expanded={expanded} onClick={() => { setLocalExpanded(!expanded); onExpandedChange?.(!expanded); }}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<Bookmark size={12} />{t('bookmarks.title', 'Bookmarks')}
      </button>
      <button type="button" className="vault-sidebar-icon-action" disabled={disabled} aria-label={t('bookmarks.add', 'Add bookmark')} title={t('bookmarks.add', 'Add bookmark')} onClick={() => { create(); }}><Plus size={14} /></button>
      <button type="button" className="vault-sidebar-icon-action" aria-label={t('views_header.more_actions', 'More actions')}
        title={t('views_header.more_actions', 'More actions')} aria-expanded={actionsOpen} aria-controls={actionsId}
        onClick={() => { setActionsOpen(!actionsOpen); }}><Ellipsis size={14} /></button>
    </div>
    {actionsOpen ? <div id={actionsId} className="mt-2 rounded border border-[var(--border-primary)] p-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={disabled} onClick={() => { create(); }}>{t('bookmarks.add', 'Add bookmark')}</button>
        {currentView ? <button type="button" disabled={disabled} onClick={createView}>{t('bookmarks.add_view', 'Save current view')}</button> : null}
        <RefreshButton className="ml-auto" disabled={isPending || busy} loading={isPending || busy} onClick={() => { void persist(bookmarks.refresh); }} />
      </div>
      <label className="mt-2 flex items-center gap-2 text-[var(--text-secondary)]">{t('bookmarks.sort', 'Sort bookmarks')}<select className="min-w-0 flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-1 py-1 text-xs" disabled={disabled} value={sortMode} onChange={(event) => { const mode = event.target.value as BookmarkSortMode; void persist(() => bookmarks.setSortMode(mode)); }}>
        {([
          ['manual', 'sidebar.sort_manual', 'Manual (drag)'], ['alpha-asc', 'sidebar.sort_alpha_asc', 'A → Z'], ['alpha-desc', 'sidebar.sort_alpha_desc', 'Z → A'], ['recent', 'sidebar.sort_recent', 'Most recent'], ['oldest', 'sidebar.sort_oldest', 'Oldest'],
        ] as const).map(([mode, key, label]) => <option key={mode} value={mode}>{t(key, label)}</option>)}
      </select></label>
    </div> : null}
    {!draft ? alert : null}
    {draftForm}
    {expanded ? <>
      {entries.length > 0 ? <label className="my-2 flex items-center gap-1 rounded border border-[var(--border-primary)] px-2 text-[var(--text-secondary)]">
        <Search size={13} className="shrink-0" /><input aria-label={t('bookmarks.filter', 'Find a bookmark')} placeholder={t('bookmarks.filter', 'Find a bookmark')} className="min-w-0 flex-1 bg-transparent py-1.5 outline-none" value={query} onChange={event => { setQuery(event.target.value); }} />
        {query ? <button type="button" aria-label={t('common.clear', 'Clear')} onClick={() => { setQuery(''); }}><X size={12} /></button> : null}
      </label> : null}
      {!isReady && !error ? <p role="status" className="mt-2 text-[var(--text-secondary)]">{t('bookmarks.loading', 'Loading bookmarks…')}</p> : isReady && entries.length === 0 ? <p className="mt-2 text-[var(--text-secondary)]">{t('bookmarks.empty', 'Save a note with its star, or add a bookmark here.')}</p> : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={drag}>
        {visibleGroups.map(({ group, entries: members }) => <div key={group} className="mt-2">
          {group || grouped.length > 1 ? <div className="mb-1 flex items-center gap-1 text-[var(--text-secondary)]">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium" aria-expanded={Boolean(needle) || !collapsedGroups.has(group)} onClick={() => { setCollapsedGroups(previous => { const next = new Set(previous); if (next.has(group)) next.delete(group); else next.add(group); return next; }); }}>
              {!needle && collapsedGroups.has(group) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<span className="truncate">{group || t('bookmarks.no_group', 'No group')}</span><span className="text-[var(--text-tertiary)]">{members.length}</span>
            </button>
            <button type="button" className="vault-sidebar-icon-action" disabled={disabled} aria-label={t('bookmarks.add_to_group', 'Add to {{group}}', { group: group || t('bookmarks.no_group', 'No group') })} onClick={() => { create(group); }}><Plus size={12} /></button>
          </div> : null}
          {!needle && collapsedGroups.has(group) ? null : <>
          <SortableContext items={members.map((entry) => entry.id)} strategy={verticalListSortingStrategy}>
            <div className="vault-sidebar__navigation-list">{members.map((entry) => <BookmarkRow key={entry.id} entry={entry} page={pages.find((page) => page.id === entry.target)}
              active={entry.kind === 'page' ? entry.target === activePageId : preview?.id === entry.id} disabled={disabled} draggable={sortMode === 'manual' && !disabled && !needle}
              onOpen={() => { if (entry.kind === 'page') onPageSelect(entry.target); else setPreviewId(previewId === entry.id ? null : entry.id); }}
              onEdit={() => { setActionError(null); setDraft(entry); }} />
            )}</div>
          </SortableContext>
          </>}
        </div>)}
      </DndContext>
      {needle && !visibleGroups.length ? <p role="status" className="mt-2 text-[var(--text-secondary)]">{t('bookmarks.no_matches', 'No matching bookmarks.')}</p> : null}
      {preview?.kind === 'search' ? <EmbeddedVaultSearch query={preview.target} onOpenPage={(id) => { onPageSelect(id); }} /> : null}
      {preview?.kind === 'section' && isBookmark(preview) ? <Suspense fallback={null}><VaultMarkdown md={`![[${preview.target}]]`} allowVaultQueries onOpenInCurrentTab={onPageSelect} idToTitle={Object.fromEntries(pages.map((page) => [page.id, page.title]))} /></Suspense> : null}
    </> : null}
  </section>;
}

export function BookmarksSection(props: BookmarksSectionProps): React.JSX.Element {
  useRequestContext();
  const vaultId = useActiveVaultId();
  return <ScopedBookmarks key={`${bookmarkScope()}:${vaultId}`} {...props} />;
}
