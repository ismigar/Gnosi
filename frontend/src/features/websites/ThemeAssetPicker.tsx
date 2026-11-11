import { ModalPortal } from '../../shared/ui/ModalPortal';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalKeyboard } from '../../shared/hooks/useModalKeyboard';
import { useTranslation } from 'react-i18next';
import { previewSiteImage, previewSiteAsset, uploadSiteThemeAsset, type SiteThemeAsset } from '../../shared/api/sites';
import type { RequestContext } from '../../shared/api/request-context';
import { apiErrorDetail } from '../../shared/api/errors';
import { useAutosaveRegistration, type RegisterAutosave } from './autosaveRequest';
import { FileImportButton, Input } from './components';

/** Uploads are independent of the configuration revision; the parent autosaves the reference. */
export function ThemeAssetPicker({ siteId, value, kind, label, context, disabled, onChange, register, assetKey, revision, onUploadState = () => undefined, compact = false, buttonLabel, onUploaded }: {
  siteId: string; value: string; kind: 'image' | 'font' | 'file'; label: string; context: RequestContext; disabled: boolean; onChange: (source: string) => void; register?: RegisterAutosave; assetKey: string; revision?: number; onUploadState?: (delta: number) => void; compact?: boolean; buttonLabel?: string; onUploaded?: (asset: SiteThemeAsset, file: File) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false); const dialog = useRef<HTMLDivElement>(null); const dialogId = useId();
  const close = useCallback(() => { setOpen(false); }, []);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useModalKeyboard({ isOpen: open, containerRef: dialog, onClose: close, closeOnEscape: !busy });
  const visible = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => { if (!visible.current || typeof IntersectionObserver === 'undefined') return; const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setInView(true); observer.disconnect(); } }, { rootMargin: '160px' }); observer.observe(visible.current); return () => { observer.disconnect(); }; }, []);
  const isImage = kind === 'image' || /\.(?:png|jpe?g|webp|gif|ico)(?:[?#]|$)/iu.test(value);
  const isFile = kind === 'font' || /\.(?:pdf|txt|csv|zip|docx|xlsx|pptx|woff2?|ttf|otf)(?:[?#]|$)/iu.test(value);
  const scopeKey = JSON.stringify([siteId, assetKey, value, kind, context.userId, context.userEmail, context.workspaceId, context.vaultId]);
  const activeScope = useRef(scopeKey);
  useLayoutEffect(() => { activeScope.current = scopeKey; }, [scopeKey]);
  const [preview, setPreview] = useState({ source: '', scope: '', url: '' });
  const previewURL = useRef('');
  const previewEnabled = inView || open;
  useEffect(() => () => { if (previewURL.current) URL.revokeObjectURL(previewURL.current); previewURL.current = ''; }, [scopeKey]);
  const task = useRef<Promise<boolean> | null>(null);
  const flush = useCallback(() => task.current ?? Promise.resolve(true), []);
  useAutosaveRegistration(register, `asset:${siteId}:${assetKey}`, busy, flush);
  const latest = useRef({ onChange, onUploaded }); const upload = useRef<AbortController | null>(null);
  useLayoutEffect(() => { latest.current = { onChange, onUploaded }; }, [onChange, onUploaded]);
  useEffect(() => () => { upload.current?.abort(); }, [scopeKey]);
  useEffect(() => {
    if (!previewEnabled || (!isImage && !isFile) || !value) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, 15_000);
    void Promise.resolve().then(() => (isImage ? previewSiteImage : previewSiteAsset)(siteId, value, context, controller.signal)).then(blob => {
      if (controller.signal.aborted || activeScope.current !== scopeKey) return;
      const url = URL.createObjectURL(blob);
      if (previewURL.current) URL.revokeObjectURL(previewURL.current);
      previewURL.current = url; setPreview({ source: value, scope: scopeKey, url });
    }).catch(() => undefined).finally(() => { clearTimeout(timer); });
    return () => { clearTimeout(timer); controller.abort(); };
  }, [siteId, value, revision, isImage, isFile, previewEnabled, context, scopeKey]);
  const choose = async (file: File) => {
    if (upload.current) return false;
    if (!file.size || file.size > 4_000_000) { setError(t('websites.assetTooLarge')); return false; }
    const controller = new AbortController(); upload.current = controller; setBusy(true); onUploadState(1); setError('');
    const timer = setTimeout(() => { controller.abort(); }, 30_000);
    try {
      const result = await uploadSiteThemeAsset(siteId, file, kind, context, controller.signal);
      if (controller.signal.aborted || activeScope.current !== scopeKey) return false;
      if (latest.current.onUploaded) latest.current.onUploaded(result, file); else latest.current.onChange(result.source); setOpen(false); return true;
    } catch (failure) { if (activeScope.current === scopeKey) setError(apiErrorDetail(failure, t('websites.assetUploadFailed'))); return false; }
    finally { clearTimeout(timer); upload.current = null; onUploadState(-1); setBusy(false); }
  };
  const accept = kind === 'font' ? '.woff,.woff2,.ttf,.otf' : kind === 'image' ? '.png,.jpg,.jpeg,.webp,.gif,.ico' : '.png,.jpg,.jpeg,.webp,.gif,.ico,.pdf,.txt,.csv,.zip,.docx,.xlsx,.pptx';
  const fileName = value.split('/').pop() || label;
  const currentPreview = value && preview.source === value && preview.scope === scopeKey && preview.url;
  return <div className="websites-asset-picker" ref={visible}>
    {!compact && <Input aria-label={label} value={value} disabled={disabled || busy} onChange={event => { latest.current.onChange(event.target.value); }} />}
    {isImage && currentPreview && <img className="websites-asset-thumbnail" src={preview.url} alt={label} loading="lazy" />}
    {!isImage && currentPreview && <a className="websites-asset-link" href={preview.url} download={fileName}>{t('websites.openAsset', { name: label })}</a>}
    <div className="websites-actions"><button type="button" className="websites-button" disabled={disabled || busy} onClick={() => { setError(''); setOpen(true); }}>{buttonLabel || t(value ? 'websites.replaceAsset' : 'websites.uploadAsset', { name: label })}</button>
      {value && !compact && <button type="button" className="websites-button" aria-label={`${t('websites.remove')} ${label}`} disabled={disabled || busy} onClick={() => { latest.current.onChange(''); }}>{t('websites.remove')}</button>}
    </div>
    {busy && <span role="status">{t('websites.uploadingAsset')}</span>}{!open && error && <p role="alert" className="websites-error">{error}</p>}
    {open && createPortal(<ModalPortal><div ref={dialog} className="websites-dialog" role="dialog" aria-modal="true" aria-labelledby={dialogId}><form onSubmit={event => { event.preventDefault(); }}>
      <h2 id={dialogId}>{t('websites.uploadAsset', { name: label })}</h2>
      <p className="websites-muted">{t(kind === 'font' ? 'websites.fontUploadHelp' : kind === 'image' ? 'websites.imageUploadHelp' : 'websites.fileUploadHelp')}</p>
      <FileImportButton label={t('websites.chooseFile')} accept={accept} disabled={disabled || busy} onFile={file => { task.current = choose(file); void task.current.finally(() => { task.current = null; }); }} />
      {busy && <span role="status">{t('websites.uploadingAsset')}</span>}{error && <p role="alert" className="websites-error">{error}</p>}
      <button type="button" className="websites-button" disabled={busy} onClick={close}>{t('websites.cancel')}</button>
    </form></div></ModalPortal>, document.body)}
  </div>;
}
