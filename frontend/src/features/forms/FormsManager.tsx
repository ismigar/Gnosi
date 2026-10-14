import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { fetchFormCandidates, fetchForms, revokeForm, type FormCandidate, type PublishedForm } from '../../shared/api/forms';
import { writeClipboardText } from '../../shared/platform/clipboard';
import { useModalKeyboard } from '../../shared/hooks/useModalKeyboard';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import { FormEditor } from './FormEditor';
import { formButtonClass } from './FormField';

interface Props { tableId: string; tableName: string; onClose: () => void }

export default function FormsManager({ tableId, tableName, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [forms, setForms] = useState<PublishedForm[]>([]);
  const [candidates, setCandidates] = useState<FormCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [busyId, setBusyId] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const controller = useRef<AbortController | null>(null);
  useModalKeyboard({ isOpen: true, onClose, containerRef: panel, trapFocus: true });
  const load = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    try {
      const [links, fields] = await Promise.all([fetchForms(tableId, current.signal), fetchFormCandidates(tableId, current.signal)]);
      if (!current.signal.aborted) { setForms(links); setCandidates(fields); setCheckedAt(Date.now()); }
    } catch { if (!current.signal.aborted) setError(t('forms.load_error', 'The forms could not be loaded.')); }
    finally { if (!current.signal.aborted) setLoading(false); }
  }, [tableId, t]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void load(); });
    return () => { active = false; controller.current?.abort(); };
  }, [load]);
  async function revoke(form: PublishedForm) {
    setBusyId(form.id); setError('');
    try { await revokeForm(form.id); setForms(previous => previous.map(item => item.id === form.id ? { ...item, revoked: true } : item)); }
    catch { setError(t('forms.revoke_error', 'The link could not be revoked.')); }
    finally { setBusyId(''); }
  }
  async function copy(form: PublishedForm) {
    try { await writeClipboardText(new URL(form.url, window.location.origin).href); setNotice(t('forms.copied', 'Link copied.')); }
    catch { setError(t('forms.copy_error', 'Copy the link from its address.')); }
  }
  return createPortal(<div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/50 p-3">
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-5 text-[var(--text-primary)] shadow-xl">
      <div className="flex items-center gap-3"><h2 id={titleId} className="flex-1 text-lg font-semibold">{t('forms.manage', 'Public forms')} · {tableName}</h2>
        <RefreshButton loading={loading} onClick={() => { setLoading(true); setError(''); void load(); }} /><button type="button" className="gnosi-close-btn" aria-label={t('common.close', 'Close')} onClick={onClose}><X size={18} /></button></div>
      <p className="my-4 text-sm text-[var(--text-secondary)]">{t('forms.reachability', 'Visitors need access to this Gnosi server. The link lets anyone submit answers until it expires or you revoke it.')}</p>
      {error && <p role="alert" className="my-3 text-sm text-[var(--status-error)]">{error}</p>}
      {notice && <p role="status" className="my-3 text-sm">{notice}</p>}
      <div className="mb-5 space-y-3">{forms.map(form => {
        const deadline = form.expires_at ? new Date(form.expires_at).getTime() : NaN;
        const available = Number.isFinite(deadline) && deadline > checkedAt;
        return <div key={form.id} className="rounded-lg border border-[var(--border-primary)] p-3">
          <div className="font-medium">{form.title}</div>
          <p className="my-1 text-xs text-[var(--text-secondary)]">{form.revoked ? t('forms.revoked', 'Revoked') : !Number.isFinite(deadline) ? t('forms.unavailable', 'This form is unavailable or has expired.') : !available ? t('forms.expired', 'Expired') : t('forms.expires_at', 'Expires {{date}}', { date: new Date(deadline).toLocaleDateString(i18n.language) })}</p>
          {!form.revoked && available && <div className="flex flex-wrap items-center gap-2">
            <a href={form.url} target="_blank" rel="noopener noreferrer" className={formButtonClass}>{t('forms.open', 'Open form')}</a>
            <button className={formButtonClass} type="button" onClick={() => { void copy(form); }}>{t('forms.copy', 'Copy link')}</button>
            <button className={formButtonClass} type="button" disabled={Boolean(busyId)} onClick={() => { void revoke(form); }}>{t('forms.revoke', 'Revoke link')}</button>
          </div>}
        </div>;
      })}</div>
      {loading ? <p role="status">{t('common.loading', 'Loading...')}</p> : candidates.length > 0 && <FormEditor key={tableId} tableId={tableId} tableName={tableName} candidates={candidates} onPublished={form => {
        setForms(previous => [form, ...previous]); setNotice(t('forms.published', 'The form is ready. Copy its link to collect responses.'));
      }} />}
    </div>
  </div>, document.body);
}
