import { lazy, Suspense, useRef, useState } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { AppWindow, Bookmark, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useActiveVaultId } from '../hooks/useActiveVaultId';
import { useRequestContext } from '../hooks/useRequestContext';
import { EmbeddedVaultSearch } from '../page-search/EmbeddedVaultSearch';
import { RefreshButton } from '../ui/actions/RefreshButton';
import { BookmarkForm, type BookmarkPage } from './BookmarkForm';
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
  const [draft, setDraft] = useState<VaultBookmark | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = entries.find((entry) => entry.id === previewId);
  const [actionError, setActionError] = useState<'invalid' | 'save' | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const disabled = !isReady || isPending || busy;
  const grouped = groupedBookmarks(entries, sortMode);
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
  const create = () => {
    const current = pages.find((page) => page.id === activePageId);
    setActionError(null); setLocalExpanded(true); onExpandedChange?.(true);
    setDraft({ id: crypto.randomUUID(), kind: 'page', label: bookmarkLabel(current?.title ?? '', current?.id), target: current?.id ?? '', group: '' });
  };
  const createView = () => {
    if (!currentView) return;
    const current = pages.find((page) => page.id === activePageId);
    const label = current?.title || document.title.replace(/\s*[·|—]\s*Gnosi.*$/u, '').trim() || t('bookmarks.route', 'Gnosi view');
    setActionError(null); setLocalExpanded(true); onExpandedChange?.(true);
    setDraft(normalizeBookmarkDestination({ id: crypto.randomUUID(), kind: 'route', label: bookmarkLabel(label), target: currentView, group: '' }));
  };
  const save = () => {
    if (!draft || disabled) return;
    if (!isBookmark(draft)) { setActionError('invalid'); return; }
    void persist(() => bookmarks.save(normalizeBookmarkDestination(draft)), true);
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
  return <section className="px-3 my-3 text-xs" aria-label={t('bookmarks.title', 'Bookmarks')} aria-busy={isPending || busy}>
    <div className="flex items-center gap-1">
      <button type="button" className="gnosi-sidebar-section-title flex flex-1 items-center gap-1 text-left" aria-expanded={expanded} onClick={() => { setLocalExpanded(!expanded); onExpandedChange?.(!expanded); }}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<Bookmark size={12} />{t('bookmarks.title', 'Bookmarks')}
      </button>
      <button type="button" disabled={disabled} onClick={create} className="vault-sidebar-icon-action" title={t('bookmarks.add', 'Add bookmark')} aria-label={t('bookmarks.add', 'Add bookmark')}><Plus size={14} /></button>
      {currentView ? <button type="button" disabled={disabled} onClick={createView} className="vault-sidebar-icon-action" title={t('bookmarks.add_view', 'Save current view')} aria-label={t('bookmarks.add_view', 'Save current view')}><AppWindow size={14} /></button> : null}
      <RefreshButton disabled={isPending || busy} loading={isPending || busy} onClick={() => { void persist(bookmarks.refresh); }} />
    </div>
    {error || actionError ? <p role="alert" className="mt-2 text-[var(--gnosi-danger)]">{actionError === 'invalid' ? t('bookmarks.invalid_target', 'Check the name and destination of the bookmark.') : actionError === 'save' ? t('bookmarks.save_failed', 'The change could not be saved. Your draft has been kept; try again.') : t('bookmarks.sync_failed', 'Bookmarks could not be synchronized. Refresh to try again.')}</p> : null}
    {expanded ? <>
      <label className="mt-2 flex items-center gap-2 text-[var(--text-secondary)]">{t('bookmarks.sort', 'Sort bookmarks')}<select className="min-w-0 flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-1 py-1 text-xs" disabled={disabled} value={sortMode} onChange={(event) => { const mode = event.target.value as BookmarkSortMode; void persist(() => bookmarks.setSortMode(mode)); }}>
        {([
          ['manual', 'sidebar.sort_manual', 'Manual (drag)'], ['alpha-asc', 'sidebar.sort_alpha_asc', 'A → Z'], ['alpha-desc', 'sidebar.sort_alpha_desc', 'Z → A'], ['recent', 'sidebar.sort_recent', 'Most recent'], ['oldest', 'sidebar.sort_oldest', 'Oldest'],
        ] as const).map(([mode, key, label]) => <option key={mode} value={mode}>{t(key, label)}</option>)}
      </select></label>
      {!isReady ? <p role="status" className="mt-2 text-[var(--text-secondary)]">{t('bookmarks.loading', 'Loading bookmarks…')}</p> : entries.length === 0 ? <p className="mt-2 text-[var(--text-secondary)]">{t('bookmarks.empty', 'Save a note with its star, or add a bookmark here.')}</p> : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={drag}>
        {grouped.map(({ group, entries: members }) => <div key={group} className="mt-2">
          {group ? <h4 className="mb-1 font-medium text-[var(--text-secondary)]">{group}</h4> : null}
          <SortableContext items={members.map((entry) => entry.id)} strategy={verticalListSortingStrategy}>
            <div className="vault-sidebar__navigation-list">{members.map((entry) => <BookmarkRow key={entry.id} entry={entry} page={pages.find((page) => page.id === entry.target)}
              active={entry.kind === 'page' ? entry.target === activePageId : preview?.id === entry.id} disabled={disabled} draggable={sortMode === 'manual' && !disabled}
              onOpen={() => { if (entry.kind === 'page') onPageSelect(entry.target); else setPreviewId(previewId === entry.id ? null : entry.id); }}
              onEdit={() => { setActionError(null); setDraft(entry); }} />)}</div>
          </SortableContext>
        </div>)}
      </DndContext>
      {draft ? <BookmarkForm draft={draft} pages={pages} activePageId={activePageId} groups={grouped.map(({ group }) => group)} disabled={disabled}
        existing={entries.some((entry) => entry.id === draft.id)} canMoveUp={sortMode === 'manual' && draftIndex > 0} canMoveDown={sortMode === 'manual' && draftIndex >= 0 && draftIndex < draftGroup.length - 1}
        onChange={setDraft} onSave={save} onCancel={() => { setDraft(null); setActionError(null); }} onMove={move}
        onRemove={() => { if (!disabled) void persist(async () => { await bookmarks.remove(draft.id); setPreviewId(null); }, true); }} /> : null}
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
