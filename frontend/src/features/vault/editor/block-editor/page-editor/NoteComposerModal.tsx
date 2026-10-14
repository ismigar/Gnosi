import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { applyNoteComposition, previewNoteComposition, type ComposerPreview, type ComposerRequest, type ComposerResult } from '../../../../../shared/api/vault-composer';
import { currentRequestContext } from '../../../../../shared/api/request-context';
import { fetchVaultPage } from '../../../../../shared/api/vaults';
import { GnosiApiError, apiErrorDetail } from '../../../../../shared/api/errors';
import { useModalKeyboard } from '../../../../../shared/hooks/useModalKeyboard';
import { useRequestContext } from '../../../../../shared/hooks/useRequestContext';
import { createPanePortal } from '../../../../../shared/ui/createPanePortal';
import { subscribeAppEvent } from '../../../../../shared/platform/app-events';

interface Props {
  readonly sourceId: string;
  readonly idToTitle: Readonly<Record<string, string>>;
  readonly flush: () => Promise<boolean>;
  readonly onFlushed: () => void;
  readonly onClose: () => void;
  readonly onApplied: (result: ComposerResult) => void;
}
const fieldClass = 'w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 text-sm text-[var(--text-primary)]';
const buttonClass = 'rounded-lg border border-[var(--border-primary)] px-3 py-2 text-sm hover:bg-[var(--bg-secondary)] disabled:opacity-50';

export function NoteComposerModal({ sourceId, idToTitle, flush, onFlushed, onClose, onApplied }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const [context] = useState(currentRequestContext);
  const activeContext = useRequestContext();
  const mounted = useRef(true);
  const invalidated = useRef(false);
  const inScope = activeContext.vaultId === context.vaultId && activeContext.workspaceId === context.workspaceId
    && activeContext.userId === context.userId && activeContext.userEmail === context.userEmail;
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ComposerPreview | null>(null);
  const [request, setRequest] = useState<ComposerRequest>({ source_id: sourceId, mode: 'extract', selection: 'note', heading: '', title: '' });
  const stillInScope = useCallback(() => {
    const current = currentRequestContext();
    return mounted.current && !invalidated.current && current.vaultId === context.vaultId && current.workspaceId === context.workspaceId
      && current.userId === context.userId && current.userEmail === context.userEmail;
  }, [context]);
  useModalKeyboard({ isOpen: true, onClose: () => { if (!busy) onClose(); }, containerRef: panelRef, trapFocus: true });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => subscribeAppEvent('gnosi:vault-changed', () => { invalidated.current = true; onClose(); }), [onClose]);
  useEffect(() => { if (!inScope) { invalidated.current = true; onClose(); } }, [inScope, onClose]);
  useEffect(() => {
    if (!inScope) return;
    const controller = new AbortController();
    const isCurrent = () => !controller.signal.aborted && stillInScope();
    void (async () => {
      try {
        if (!await flush()) throw new Error('Save did not settle');
        if (!isCurrent()) return;
        onFlushed();
        const page = await fetchVaultPage(sourceId, controller.signal, context);
        if (isCurrent()) setSource(page.content);
      } catch (cause) {
        if (isCurrent()) setError(apiErrorDetail(cause, t('composer.save_error', 'Save your pending edits successfully before composing notes.')));
      } finally {
        if (isCurrent()) setLoading(false);
      }
    })();
    return () => { controller.abort(); };
  }, [context, flush, inScope, onFlushed, sourceId, stillInScope, t]);
  const update = (patch: Partial<ComposerRequest>) => { setRequest(current => ({ ...current, ...patch })); setPreview(null); setError(''); };
  const prepare = async () => {
    if (busy || !stillInScope()) return;
    setBusy(true); setError(''); setPreview(null);
    try {
      if (!await flush()) throw new Error('Save did not settle');
      if (!stillInScope()) return;
      const result = await previewNoteComposition(request, context);
      if (stillInScope()) setPreview(result);
    } catch (cause) {
      if (stillInScope()) setError(apiErrorDetail(cause, t('composer.preview_error', 'The preview could not be prepared. Save pending edits and try again.')));
    } finally { if (stillInScope()) setBusy(false); }
  };
  const apply = async () => {
    if (busy || !preview || !stillInScope()) return;
    setBusy(true); setError('');
    try {
      const result = await applyNoteComposition(preview, context);
      if (stillInScope()) onApplied(result);
    } catch (cause) {
      if (!stillInScope()) return;
      setPreview(null);
      setError(cause instanceof GnosiApiError && cause.status === 409
        ? t('composer.conflict', 'A note or its links changed. Review a fresh preview before applying.')
        : apiErrorDetail(cause, t('composer.apply_error', 'The operation could not be completed. Refresh the notes before trying again.')));
    } finally { if (stillInScope()) setBusy(false); }
  };
  const selectLines = () => {
    const textarea = sourceRef.current;
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) return;
    const startLine = source.slice(0, textarea.selectionStart).split('\n').length;
    const endLine = source.slice(0, textarea.selectionEnd - (source[textarea.selectionEnd - 1] === '\n' ? 1 : 0)).split('\n').length;
    update({ selection: 'lines', start_line: startLine, end_line: endLine });
  };
  const valid = !loading && Boolean(source) && (request.mode === 'merge' ? Boolean(request.target_id) : Boolean(request.title.trim()))
    && (request.selection !== 'heading' || Boolean(request.heading.trim()))
    && (request.selection !== 'lines' || Boolean(request.start_line && request.end_line && request.end_line >= request.start_line));
  if (!inScope) return null;
  return createPanePortal(<div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4">
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[var(--border-primary)] p-4">
        <h2 id={titleId} className="font-semibold">{t('composer.title', 'Compose notes')}</h2>
        <button type="button" disabled={busy} className="gnosi-close-btn" onClick={onClose} aria-label={t('common.close', 'Close')}><X size={18} /></button>
      </div>
      <div className="space-y-4 overflow-auto p-4">
        <p className="text-sm text-[var(--text-secondary)]">{t('composer.explanation', 'Move Markdown into a new or existing note. The source keeps an embed, its properties and its history. Links to moved content are updated in the preview.')}</p>
        <fieldset disabled={busy || loading} className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">{t('composer.operation', 'Operation')}<select className={fieldClass} value={request.mode} onChange={event => { update({ mode: event.target.value === 'merge' ? 'merge' : 'extract', target_id: null }); }}>
            <option value="extract">{t('composer.extract', 'Extract to a new note')}</option><option value="merge">{t('composer.merge', 'Merge into an existing note')}</option>
          </select></label>
          {request.mode === 'extract' ? <label className="space-y-1 text-sm">{t('composer.new_title', 'New note title')}<input data-autofocus className={fieldClass} value={request.title} maxLength={200} onChange={event => { update({ title: event.target.value }); }} /></label>
            : <label className="space-y-1 text-sm">{t('composer.destination', 'Destination')}<select className={fieldClass} value={request.target_id ?? ''} onChange={event => { update({ target_id: event.target.value }); }}>
              <option value="">{t('composer.choose_note', 'Choose a note')}</option>{Object.entries(idToTitle).filter(([id]) => id !== sourceId).sort((a, b) => a[1].localeCompare(b[1])).map(([id, title]) => <option key={id} value={id}>{title}</option>)}
            </select></label>}
          <label className="space-y-1 text-sm">{t('composer.content', 'Content to move')}<select className={fieldClass} value={request.selection} onChange={event => { update({ selection: event.target.value as ComposerRequest['selection'] }); }}>
            <option value="note">{t('composer.whole_note', 'Whole note')}</option><option value="heading">{t('composer.heading', 'Heading and its content')}</option><option value="lines">{t('composer.lines', 'Selected Markdown lines')}</option>
          </select></label>
          {request.selection === 'heading' && <label className="space-y-1 text-sm">{t('composer.heading_name', 'Heading text')}<input className={fieldClass} value={request.heading} onChange={event => { update({ heading: event.target.value }); }} /></label>}
          {request.selection === 'lines' && <div className="flex gap-2"><label className="text-sm">{t('composer.start_line', 'First line')}<input type="number" min={1} className={fieldClass} value={request.start_line ?? ''} onChange={event => { update({ start_line: event.target.value ? Number(event.target.value) : null }); }} /></label><label className="text-sm">{t('composer.end_line', 'Last line')}<input type="number" min={request.start_line ?? 1} className={fieldClass} value={request.end_line ?? ''} onChange={event => { update({ end_line: event.target.value ? Number(event.target.value) : null }); }} /></label></div>}
        </fieldset>
        <details open={!preview}><summary className="cursor-pointer text-sm">{t('composer.source', 'Source Markdown')}</summary><textarea ref={sourceRef} value={source} readOnly className={`${fieldClass} mt-2 h-48 font-mono`} aria-label={t('composer.source', 'Source Markdown')} /><button type="button" className={buttonClass} disabled={busy || loading} onClick={selectLines}>{t('composer.use_selection', 'Use selected lines')}</button><p className="mt-1 text-xs text-[var(--text-tertiary)]">{t('composer.complete_blocks', 'Select complete paragraphs, lists or code fences, separated by blank lines.')}</p></details>
        {loading && <p role="status">{t('common.loading', 'Loading…')}</p>}
        {error && <p role="alert" className="text-sm text-[var(--status-error)]">{error}</p>}
        {preview && <section aria-label={t('composer.review', 'Review changes')} className="space-y-3">
          <p className="text-sm">{t('composer.changed_notes', '{{count}} notes will change. Every existing note keeps a history version.', { count: preview.changes.length })}</p>
          {preview.changes.map(change => <details key={change.id} open={change.id === sourceId || change.created} className="rounded-lg border border-[var(--border-primary)] p-3"><summary className="cursor-pointer font-medium">{change.title}{change.created ? ` — ${t('composer.new_note', 'New note')}` : ''}</summary><div className="mt-2 grid gap-3 sm:grid-cols-2"><label className="text-xs">{t('composer.before', 'Before')}<pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--bg-secondary)] p-2 font-mono">{change.before}</pre></label><label className="text-xs">{t('composer.after', 'After')}<pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--bg-secondary)] p-2 font-mono">{change.after}</pre></label></div></details>)}
        </section>}
      </div>
      <div className="flex justify-end gap-2 border-t border-[var(--border-primary)] p-4">
        <button type="button" className={buttonClass} disabled={busy} onClick={onClose}>{t('common.cancel', 'Cancel')}</button>
        <button type="button" className={buttonClass} disabled={busy || !valid} onClick={() => { void prepare(); }}>{t('composer.preview', 'Preview changes')}</button>
        <button type="button" className={`${buttonClass} bg-[var(--gnosi-blue)] text-white`} disabled={busy || !preview} onClick={() => { void apply(); }}>{busy ? t('common.loading', 'Loading…') : t('composer.apply', 'Apply reviewed changes')}</button>
      </div>
    </div>
  </div>, document.body);
}
