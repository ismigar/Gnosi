import { ModalPortal } from '../ui/ModalPortal';
import { useId, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Bookmark, Check, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { PanePortal } from '../ui/PanePortal';
import { isDashboardPage } from '../records/model/pageKind';
import { currentBookmarkRoute } from './bookmark-routes';
import { bookmarkLabel, type BookmarkKind, type VaultBookmark } from './bookmarks';
import { BookmarkPagePicker } from './BookmarkPagePicker';
import { bookmarkSearchText } from './bookmarks';
import { BookmarkSectionPicker } from './BookmarkSectionPicker';

export interface BookmarkPage {
  readonly id: string;
  readonly title: string;
  readonly folder?: string | null;
  readonly metadata?: { readonly icon?: string | null; readonly is_dashboard?: boolean };
}
interface Props {
  readonly draft: VaultBookmark;
  readonly pages: readonly BookmarkPage[];
  readonly activePageId?: string | null;
  readonly groups: readonly string[];
  readonly disabled: boolean;
  readonly existing: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly error?: ReactNode;
  readonly onChange: (entry: VaultBookmark) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onRemove: () => void;
  readonly onMove: (direction: -1 | 1) => void;
}
const appRoots = ['knowledge', 'graph', 'calendar', 'reader', 'mail', 'automations', 'social', 'media', 'contacts', 'planning', 'resources', 'notebooks'] as const;

function ViewDestination({ draft, currentPageTitle, nameEdited, onChange }: Pick<Props, 'draft' | 'onChange'> & { readonly currentPageTitle: string; readonly nameEdited: boolean }) {
  const { t } = useTranslation();
  const currentView = currentBookmarkRoute();
  const choose = (target: string, label: string) => { onChange({ ...draft, target, label: nameEdited ? draft.label : bookmarkLabel(label) }); };
  return <div className="space-y-3">
    <p className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-sm">{draft.label || t('bookmarks.choose_view', 'Choose a view below')}</p>
    {currentView && (draft.kind !== 'graph' || currentView.startsWith('/graph')) ? <button type="button" className="gnosi-button w-full" onClick={() => { choose(currentView, currentPageTitle || t('bookmarks.current_view', 'Current view')); }}>{t('bookmarks.use_current_view', 'Use the current view')}</button> : null}
    {draft.kind === 'route' ? <div className="grid grid-cols-2 gap-2" aria-label={t('bookmarks.choose_view', 'Choose a view below')}>
      {appRoots.map(app => <button key={app} type="button" aria-pressed={draft.target === `/${app}`} className="gnosi-button justify-start" onClick={() => { choose(`/${app}`, t(`bookmarks.destinations.${app}`)); }}>{draft.target === `/${app}` ? <Check size={14} /> : null}{t(`bookmarks.destinations.${app}`)}</button>)}
    </div> : <button type="button" className="gnosi-button" onClick={() => { choose('/graph', t('bookmarks.graph', 'Graph view')); }}>{t('bookmarks.whole_graph', 'Whole graph')}</button>}
    <details className="text-xs text-[var(--text-secondary)]"><summary className="cursor-pointer">{t('bookmarks.advanced_address', 'Advanced: edit address')}</summary>
      <label className="mt-2 block">{t('bookmarks.route_target', 'View address')}<input className="gnosi-input mt-1 w-full" value={draft.target} maxLength={2000} onChange={event => { onChange({ ...draft, target: event.target.value }); }} /></label>
    </details>
  </div>;
}

export function BookmarkForm({ draft, pages, activePageId, groups, disabled, existing, canMoveUp, canMoveDown, error, onChange, onSave, onCancel, onRemove, onMove }: Props) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [nameEdited, setNameEdited] = useState(existing);
  const [destinationKind, setDestinationKind] = useState<string>(draft.kind === 'page' && isDashboardPage(pages.find(page => page.id === draft.target)) ? 'dashboard' : draft.kind);
  const [selectedTitle, setSelectedTitle] = useState(pages.find(page => page.id === draft.target.split('#')[0])?.title ?? draft.label);
  const pageId = draft.kind === 'page' ? draft.target : draft.target.split('#')[0] ?? '';
  const currentPage = pages.find(page => page.id === activePageId);
  const changeKind = (choice: string) => {
    setDestinationKind(choice);
    const kind = (choice === 'dashboard' ? 'page' : choice) as BookmarkKind;
    const selectedPage = choice === 'dashboard' ? isDashboardPage(currentPage) ? currentPage : undefined : currentPage;
    const target = kind === 'route' ? currentBookmarkRoute() ?? '/knowledge' : kind === 'graph' ? '/graph' : kind === 'page' || kind === 'section' ? selectedPage?.id ?? '' : '';
    const label = kind === 'page' || kind === 'section' ? selectedPage?.title ?? '' : kind === 'url' || kind === 'search' ? '' : t(`bookmarks.${kind}`);
    setSelectedTitle(selectedPage?.title ?? '');
    onChange({ ...draft, kind, target, label: nameEdited ? draft.label : bookmarkLabel(label) });
  };
  useModalKeyboard({ containerRef: panelRef, isOpen: true, onClose: () => { if (!disabled) onCancel(); }, trapFocus: true });
  const choosePage = (page: BookmarkPage) => {
    setSelectedTitle(page.title);
    onChange({ ...draft, target: page.id, label: nameEdited && draft.label.trim() ? draft.label : bookmarkLabel(page.title) });
  };
  const matchingGroups = groups.filter(group => group && (groups.length <= 12 || bookmarkSearchText(group).includes(bookmarkSearchText(draft.group)))).slice(0, 12);
  return <PanePortal container={document.body}>
    <ModalPortal><div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-5 py-4">
          <Bookmark size={18} /><h3 id={titleId} className="flex-1 text-base font-semibold">{existing ? t('bookmarks.edit_title', 'Edit bookmark') : t('bookmarks.add', 'Add bookmark')}</h3>
          <button type="button" className="gnosi-icon-button" disabled={disabled} aria-label={t('common.close', 'Close')} onClick={onCancel}><X size={18} /></button>
        </div>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); onSave(); }}>
          <div className="min-h-0 flex-1 overflow-y-auto">
          <fieldset disabled={disabled} className="min-w-0 space-y-4 px-5 py-4">
            <label className="block text-sm">{t('bookmarks.kind', 'Type')}<select aria-label={t('bookmarks.kind', 'Type')} className="gnosi-input mt-1 w-full" value={destinationKind} onChange={event => { changeKind(event.target.value); }}>
              {(['page', 'dashboard', 'section', 'search', 'graph', 'route', 'url'] as const).map(kind => <option key={kind} value={kind}>{kind === 'route' ? t('bookmarks.route', 'Gnosi view') : t(`bookmarks.${kind}`)}</option>)}
            </select></label>
            {draft.kind === 'page' || draft.kind === 'section' ? <div className="space-y-2">
              {currentPage && (destinationKind !== 'dashboard' || isDashboardPage(currentPage)) ? <button type="button" className="gnosi-button w-full" onClick={() => { choosePage(currentPage); }}>{isDashboardPage(currentPage) ? t('bookmarks.use_current_dashboard', 'Use the open dashboard') : t('bookmarks.use_current_note', 'Use the open note')}: <span className="truncate">{currentPage.title}</span></button> : null}
              <BookmarkPagePicker key={destinationKind} pages={pages} selectedId={pageId} selectedLabel={selectedTitle} onlyDashboards={destinationKind === 'dashboard'} onSelect={choosePage} />
              {draft.kind === 'section' ? <BookmarkSectionPicker key={pageId} pageId={pageId} value={draft.target.split('#').slice(1).join('#')} onChange={value => { onChange({ ...draft, target: `${pageId}#${value}`, label: nameEdited ? draft.label : bookmarkLabel(`${selectedTitle} · ${value}`) }); }} /> : null}
            </div> : null}
            {draft.kind === 'route' || draft.kind === 'graph' ? <ViewDestination draft={draft} currentPageTitle={currentPage?.title ?? ''} nameEdited={nameEdited} onChange={onChange} /> : null}
            {draft.kind === 'url' || draft.kind === 'search' ? <label className="block text-sm">{t(draft.kind === 'search' ? 'bookmarks.query' : 'bookmarks.url')}
              <input className="gnosi-input mt-1 w-full" value={draft.target} required maxLength={2000} type={draft.kind === 'url' ? 'url' : 'text'} placeholder={draft.kind === 'url' ? 'https://…' : t('bookmarks.search_example', 'Words, tags or a saved search expression…')}
                onChange={event => { const target = event.target.value; let label = target; if (draft.kind === 'url') { try { label = new URL(target).hostname; } catch { label = ''; } } onChange({ ...draft, target, label: nameEdited ? draft.label : bookmarkLabel(label) }); }} />
            </label> : null}
            <label className="block text-sm">{t('bookmarks.name', 'Name')}<input data-autofocus={Boolean(draft.target) || undefined} className="gnosi-input mt-1 w-full" value={draft.label} maxLength={200} required onChange={event => { setNameEdited(true); onChange({ ...draft, label: event.target.value }); }} /></label>
            <div className="space-y-2">
              <label className="block text-sm">{t('bookmarks.group', 'Group')}<input className="gnosi-input mt-1 w-full" value={draft.group} maxLength={100} placeholder={t('bookmarks.group_placeholder', 'Choose below, search or create a group…')} onChange={event => { onChange({ ...draft, group: event.target.value }); }} /></label>
              <div className="flex flex-wrap gap-2" aria-label={t('bookmarks.available_groups', 'Available groups')}>
                {['', ...matchingGroups].map(group => <button key={group} type="button" aria-pressed={draft.group === group} className={`rounded-full border px-3 py-1 text-xs ${draft.group === group ? 'border-[var(--gnosi-primary)] bg-[var(--bg-secondary)] text-[var(--gnosi-primary)]' : 'border-[var(--border-primary)]'}`} onClick={() => { onChange({ ...draft, group }); }}>{group || t('bookmarks.no_group', 'No group')}</button>)}
              </div>
              <p className="text-xs text-[var(--text-secondary)]">{t('bookmarks.group_help', 'Optional. Choose an existing group or type a new name.')}</p>
            </div>
            {existing ? <div className="flex items-center gap-2 border-t border-[var(--border-primary)] pt-3">
              <span className="flex-1 text-sm text-[var(--text-secondary)]">{t('bookmarks.position', 'Position in the group')}</span>
              <button type="button" className="gnosi-icon-button" disabled={!canMoveUp} aria-label={t('bookmarks.up', 'Move up')} onClick={() => { onMove(-1); }}><ArrowUp size={16} /></button>
              <button type="button" className="gnosi-icon-button" disabled={!canMoveDown} aria-label={t('bookmarks.down', 'Move down')} onClick={() => { onMove(1); }}><ArrowDown size={16} /></button>
              <button type="button" className="gnosi-button text-[var(--gnosi-danger)]" onClick={onRemove}><Trash2 size={14} />{t('common.delete', 'Delete')}</button>
            </div> : null}
          </fieldset>
          </div>
          {error ? <div className="px-5 pb-3 text-sm">{error}</div> : null}
          <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border-primary)] px-5 py-3">
            <button type="button" className="gnosi-button" disabled={disabled} onClick={onCancel}>{t('common.cancel', 'Cancel')}</button>
            <button type="submit" className="gnosi-button gnosi-button--primary disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled || !draft.label.trim() || !draft.target.trim()}>{t('common.save', 'Save')}</button>
          </div>
        </form>
      </div>
    </div></ModalPortal>
  </PanePortal>;
}
