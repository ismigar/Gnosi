import { lazy, Suspense, useId, useState } from 'react';
import { Bookmark, ChevronDown, ChevronRight, Pencil, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useActiveVaultId } from '../hooks/useActiveVaultId';
import { useRequestContext } from '../hooks/useRequestContext';
import { EmbeddedVaultSearch } from '../page-search/EmbeddedVaultSearch';
import { vaultPath } from '../routing/vaultRouting';
import { bookmarkScope, isBookmark, loadBookmarks, moveBookmark, saveBookmarks, type BookmarkKind, type VaultBookmark } from './bookmarks';

const VaultMarkdown = lazy(() => import('../editor/VaultMarkdown'));

interface BookmarksSectionProps {
  readonly onPageSelect: (id: string) => unknown;
  readonly pages: readonly { readonly id: string; readonly title: string }[];
  readonly activePageId?: string | null;
}

function ScopedBookmarks({ onPageSelect, pages, activePageId, scope }: BookmarksSectionProps & { readonly scope: string }) {
  const { t } = useTranslation();
  const groupsId = useId();
  const [entries, setEntries] = useState(() => loadBookmarks(scope));
  const [expanded, setExpanded] = useState(true);
  const [draft, setDraft] = useState<VaultBookmark | null>(null);
  const [preview, setPreview] = useState<VaultBookmark | null>(null);
  const [error, setError] = useState(false);
  const persist = (next: VaultBookmark[]) => {
    if (!saveBookmarks(scope, next)) { setError(true); return; }
    setEntries(next); setError(false); setDraft(null);
  };
  const groups = [...new Set(entries.map((entry) => entry.group))];
  const fieldClass = 'w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-primary)]';
  const create = () => {
    const current = pages.find((page) => page.id === activePageId);
    setDraft({ id: crypto.randomUUID(), kind: 'page', label: current?.title ?? '', target: current?.id ?? '', group: '' });
  };
  return <section className="px-3 my-3 text-xs">
    <div className="flex items-center gap-1">
      <button type="button" className="gnosi-sidebar-section-title flex flex-1 items-center gap-1 text-left" aria-expanded={expanded} onClick={() => { setExpanded(!expanded); }}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<Bookmark size={12} />{t('bookmarks.title', 'Bookmarks')}
      </button>
      <button type="button" onClick={create} className="vault-sidebar-icon-action" title={t('bookmarks.add', 'Add bookmark')} aria-label={t('bookmarks.add', 'Add bookmark')}><Plus size={14} /></button>
    </div>
    {expanded ? groups.map((group) => <div key={group} className="mt-2">
      {group ? <h4 className="mb-1 font-medium text-[var(--text-secondary)]">{group}</h4> : null}
      {entries.filter((entry) => entry.group === group).map((entry) => <div key={entry.id} className="group flex items-center gap-1 rounded hover:bg-[var(--bg-secondary)]">
        {entry.kind === 'url' || entry.kind === 'graph' ? <a className="min-w-0 flex-1 truncate py-1 text-[var(--text-primary)]" href={entry.target} target={entry.kind === 'url' ? '_blank' : undefined} rel="noopener noreferrer">{entry.label}</a>
          : <button type="button" className="min-w-0 flex-1 truncate py-1 text-left text-[var(--text-primary)]" onClick={() => { if (entry.kind === 'page') onPageSelect(entry.target); else setPreview(preview?.id === entry.id ? null : entry); }}>{entry.label}</button>}
        <button type="button" className="vault-sidebar-icon-action" title={t('common.edit', 'Edit')} aria-label={t('common.edit', 'Edit')} onClick={() => { setDraft(entry); }}><Pencil size={11} /></button>
      </div>)}
    </div>) : null}
    {error ? <p role="alert" className="mt-2 text-[var(--gnosi-danger)]">{t('bookmarks.save_failed', 'The bookmark could not be saved. Check its target and local storage.')}</p> : null}
    {draft ? <form className="mt-2 space-y-2 rounded border border-[var(--border-primary)] p-2" onSubmit={(event) => {
      event.preventDefault();
      if (!isBookmark(draft)) { setError(true); return; }
      persist(entries.some((entry) => entry.id === draft.id) ? entries.map((entry) => entry.id === draft.id ? draft : entry) : [...entries, draft]);
    }}>
      <label className="block">{t('bookmarks.name', 'Name')}<input className={fieldClass} value={draft.label} maxLength={200} required onChange={(event) => { setDraft({ ...draft, label: event.target.value }); }} /></label>
      <label className="block">{t('bookmarks.kind', 'Type')}<select className={fieldClass} value={draft.kind} onChange={(event) => { const kind = event.target.value as BookmarkKind; setDraft({ ...draft, kind, target: kind === 'graph' ? vaultPath('graph') : kind === 'page' || kind === 'section' ? activePageId ?? '' : '' }); }}>
        {(['page', 'section', 'search', 'graph', 'url'] as const).map((kind) => <option key={kind} value={kind}>{t(`bookmarks.${kind}`)}</option>)}
      </select></label>
      {draft.kind === 'page' || draft.kind === 'section' ? <label className="block">{t('bookmarks.page', 'Note')}<select className={fieldClass} value={draft.target.split('#')[0] ?? ''} required onChange={(event) => { setDraft({ ...draft, target: event.target.value + (draft.kind === 'section' ? `#${draft.target.split('#').slice(1).join('#')}` : '') }); }}>
        <option value="">{t('bookmarks.choose_note', 'Choose a note')}</option>{pages.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}
      </select></label> : null}
      {draft.kind === 'section' ? <label className="block">{t('bookmarks.section_name', 'Heading or block reference')}<input className={fieldClass} value={draft.target.split('#').slice(1).join('#')} required onChange={(event) => { setDraft({ ...draft, target: `${draft.target.split('#')[0] ?? ''}#${event.target.value}` }); }} /></label> : null}
      {draft.kind === 'search' || draft.kind === 'url' ? <label className="block">{t(draft.kind === 'search' ? 'bookmarks.query' : 'bookmarks.url')}<input className={fieldClass} value={draft.target} required maxLength={2000} type={draft.kind === 'url' ? 'url' : 'text'} onChange={(event) => { setDraft({ ...draft, target: event.target.value }); }} /></label> : null}
      <label className="block">{t('bookmarks.group', 'Group')}<input className={fieldClass} list={groupsId} value={draft.group} maxLength={100} onChange={(event) => { setDraft({ ...draft, group: event.target.value }); }} /></label>
      <datalist id={groupsId}>{groups.map((group) => <option key={group} value={group} />)}</datalist>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="text-[var(--gnosi-primary)]">{t('common.save', 'Save')}</button>
        <button type="button" onClick={() => { setDraft(null); setError(false); }}>{t('common.cancel', 'Cancel')}</button>
        {entries.some((entry) => entry.id === draft.id) ? <>
          <button type="button" aria-label={t('bookmarks.up', 'Move up')} onClick={() => { persist(moveBookmark(entries, draft.id, -1)); }}><ArrowUp size={14} /></button>
          <button type="button" aria-label={t('bookmarks.down', 'Move down')} onClick={() => { persist(moveBookmark(entries, draft.id, 1)); }}><ArrowDown size={14} /></button>
          <button type="button" aria-label={t('common.delete', 'Delete')} onClick={() => { persist(entries.filter((entry) => entry.id !== draft.id)); setPreview(null); }}><Trash2 size={14} /></button>
        </> : null}
      </div>
    </form> : null}
    {preview?.kind === 'search' ? <EmbeddedVaultSearch query={preview.target} onOpenPage={(id) => { onPageSelect(id); }} /> : null}
    {preview?.kind === 'section' ? <Suspense fallback={null}><VaultMarkdown md={`![[${preview.target}]]`} allowVaultQueries onOpenInCurrentTab={onPageSelect} idToTitle={Object.fromEntries(pages.map((page) => [page.id, page.title]))} /></Suspense> : null}
  </section>;
}

export function BookmarksSection(props: BookmarksSectionProps): React.JSX.Element {
  useRequestContext();
  const vaultId = useActiveVaultId();
  const scope = bookmarkScope();
  return <ScopedBookmarks key={`${scope}:${vaultId}`} {...props} scope={scope} />;
}
