import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchVaultPage } from '../api/vaults';
import { useRequestContext } from '../hooks/useRequestContext';
import { listSectionReferences } from '../editor/vault-markdown/transclusionModel';

export function BookmarkSectionPicker({ pageId, value, onChange }: { readonly pageId: string; readonly value: string; readonly onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const context = useRequestContext();
  const [state, setState] = useState({ pageId: '', content: '', error: false });
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!pageId) return;
    const controller = new AbortController();
    void fetchVaultPage(pageId, controller.signal, context).then(page => {
      if (!controller.signal.aborted) setState({ pageId, content: page.content, error: false });
    }).catch(() => { if (!controller.signal.aborted) setState({ pageId, content: '', error: true }); });
    return () => { controller.abort(); };
  }, [pageId, context, revision]);
  const references = useMemo(() => state.pageId === pageId ? listSectionReferences(state.content) : [], [state, pageId]);
  const filtered = references.filter(reference => reference.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <div className="space-y-2">
    <label className="block text-sm">{t('bookmarks.find_section', 'Choose a heading or passage')}
      <input className="gnosi-input mt-1 w-full" value={query} onChange={event => { setQuery(event.target.value); }} placeholder={t('bookmarks.filter_sections', 'Filter headings and passages…')} />
    </label>
    <div className="max-h-36 overflow-y-auto rounded-lg border border-[var(--border-primary)]" aria-label={t('bookmarks.sections', 'Headings and passages')}>
      {filtered.map(reference => <button key={reference.target} type="button" aria-pressed={reference.target === value} onClick={() => { onChange(reference.target); }}
        className={`block w-full px-3 py-2 text-left text-sm hover:bg-[var(--bg-secondary)] ${reference.target === value ? 'bg-[var(--bg-secondary)] text-[var(--gnosi-primary)]' : ''}`}>{reference.label}</button>)}
      {state.pageId !== pageId && pageId ? <p role="status" className="p-3 text-xs">{t('bookmarks.loading_sections', 'Loading headings and passages…')}</p> : null}
      {state.pageId === pageId && !filtered.length && !state.error ? <p className="p-3 text-xs text-[var(--text-secondary)]">{t('bookmarks.no_sections', 'No matching headings or marked passages in this note.')}</p> : null}
    </div>
    {state.pageId === pageId && state.error ? <p role="alert" className="text-sm text-[var(--gnosi-danger)]">{t('bookmarks.sections_failed', 'The note could not be loaded.')} <button type="button" className="underline" onClick={() => { setRevision(revision + 1); }}>{t('common.retry', 'Retry')}</button></p> : null}
    {value ? <p className="break-words text-sm text-[var(--text-secondary)]">{t('bookmarks.selected_section', 'Selected: {{name}}', { name: references.find(reference => reference.target === value)?.label ?? value })}</p> : null}
    <details className="text-xs text-[var(--text-secondary)]"><summary className="cursor-pointer">{t('bookmarks.manual_reference', 'Enter a reference manually')}</summary>
      <label className="mt-2 block">{t('bookmarks.section_name', 'Heading or block reference')}<input className="gnosi-input mt-1 w-full" value={value} maxLength={2000} onChange={event => { onChange(event.target.value); }} /></label>
    </details>
  </div>;
}
