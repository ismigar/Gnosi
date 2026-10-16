import { useId } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { vaultPath } from '../routing/vaultRouting';
import { currentBookmarkRoute } from './bookmark-routes';
import type { BookmarkKind, VaultBookmark } from './bookmarks';

export interface BookmarkPage {
  readonly id: string;
  readonly title: string;
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
  readonly onChange: (entry: VaultBookmark) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onRemove: () => void;
  readonly onMove: (direction: -1 | 1) => void;
}

export function BookmarkForm({ draft, pages, activePageId, groups, disabled, existing, canMoveUp, canMoveDown, onChange, onSave, onCancel, onRemove, onMove }: Props) {
  const { t } = useTranslation();
  const groupsId = useId();
  const fieldClass = 'w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-primary)]';
  const pageId = draft.kind === 'page' ? draft.target : draft.target.split('#')[0] ?? '';
  return <form className="mt-2 rounded border border-[var(--border-primary)] p-2" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <fieldset className="space-y-2" disabled={disabled}>
      <label className="block">{t('bookmarks.name', 'Name')}<input className={fieldClass} value={draft.label} maxLength={200} required onChange={(event) => { onChange({ ...draft, label: event.target.value }); }} /></label>
      <label className="block">{t('bookmarks.kind', 'Type')}<select className={fieldClass} value={draft.kind} onChange={(event) => {
        const kind = event.target.value as BookmarkKind;
        onChange({ ...draft, kind, target: kind === 'route' ? currentBookmarkRoute() ?? '' : kind === 'graph' ? vaultPath('graph') : kind === 'page' || kind === 'section' ? activePageId ?? '' : '' });
      }}>
        {(['page', 'section', 'search', 'graph', 'route', 'url'] as const).map((kind) => <option key={kind} value={kind}>{kind === 'route' ? t('bookmarks.route', 'Gnosi view') : t(`bookmarks.${kind}`)}</option>)}
      </select></label>
      {draft.kind === 'page' || draft.kind === 'section' ? <label className="block">{t('bookmarks.page', 'Note')}<select className={fieldClass} value={pageId} required onChange={(event) => {
        onChange({ ...draft, target: event.target.value + (draft.kind === 'section' ? `#${draft.target.split('#').slice(1).join('#')}` : '') });
      }}>
        <option value="">{t('bookmarks.choose_note', 'Choose a note')}</option>
        {pageId && !pages.some((page) => page.id === pageId) ? <option value={pageId}>{pageId}</option> : null}
        {pages.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}
      </select></label> : null}
      {draft.kind === 'section' ? <label className="block">{t('bookmarks.section_name', 'Heading or block reference')}<input className={fieldClass} value={draft.target.split('#').slice(1).join('#')} required maxLength={2000} onChange={(event) => { onChange({ ...draft, target: `${pageId}#${event.target.value}` }); }} /></label> : null}
      {draft.kind === 'search' || draft.kind === 'url' || draft.kind === 'route' ? <label className="block">{draft.kind === 'route' ? t('bookmarks.route_target', 'View address') : t(draft.kind === 'search' ? 'bookmarks.query' : 'bookmarks.url')}<input className={fieldClass} value={draft.target} required maxLength={2000} type={draft.kind === 'url' ? 'url' : 'text'} onChange={(event) => { onChange({ ...draft, target: event.target.value }); }} /></label> : null}
      <label className="block">{t('bookmarks.group', 'Group')}<input className={fieldClass} list={groupsId} value={draft.group} maxLength={100} onChange={(event) => { onChange({ ...draft, group: event.target.value }); }} /></label>
      <datalist id={groupsId}>{groups.map((group) => <option key={group} value={group} />)}</datalist>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="text-[var(--gnosi-primary)]">{t('common.save', 'Save')}</button>
        <button type="button" onClick={onCancel}>{t('common.cancel', 'Cancel')}</button>
        {existing ? <>
          <button type="button" disabled={!canMoveUp} aria-label={t('bookmarks.up', 'Move up')} onClick={() => { onMove(-1); }}><ArrowUp size={14} /></button>
          <button type="button" disabled={!canMoveDown} aria-label={t('bookmarks.down', 'Move down')} onClick={() => { onMove(1); }}><ArrowDown size={14} /></button>
          <button type="button" aria-label={t('common.delete', 'Delete')} onClick={onRemove}><Trash2 size={14} /></button>
        </> : null}
      </div>
    </fieldset>
  </form>;
}
