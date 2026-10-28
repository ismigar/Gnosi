import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { previewSiteImage, uploadSiteThemeAsset } from '../../shared/api/sites';
import type { RequestContext } from '../../shared/api/request-context';
import { apiErrorDetail } from '../../shared/api/errors';
import { useAutosaveRegistration, type RegisterAutosave } from './autosaveRequest';
import { FileImportButton } from './components';

/** Uploads are independent of the configuration revision; the parent autosaves the reference. */
export function ThemeAssetPicker({ siteId, value, kind, label, context, disabled, onChange, register, assetKey, onUploadState }: {
  siteId: string; value: string; kind: 'image' | 'font'; label: string; context: RequestContext; disabled: boolean; onChange: (source: string) => void; register?: RegisterAutosave; assetKey: string; onUploadState: (delta: number) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const scopeKey = JSON.stringify([siteId, context.userId, context.userEmail, context.workspaceId, context.vaultId]);
  const activeScope = useRef(scopeKey);
  useLayoutEffect(() => { activeScope.current = scopeKey; }, [scopeKey]);
  const [preview, setPreview] = useState({ source: '', scope: '', url: '' });
  const task = useRef<Promise<boolean> | null>(null);
  const flush = useCallback(() => task.current ?? Promise.resolve(true), []);
  useAutosaveRegistration(register, `asset:${siteId}:${assetKey}`, busy, flush);
  const latest = useRef(onChange); const upload = useRef<AbortController | null>(null);
  useLayoutEffect(() => { latest.current = onChange; }, [onChange]);
  useEffect(() => () => { upload.current?.abort(); }, [scopeKey]);
  useEffect(() => {
    if (kind !== 'image' || !value) return;
    const controller = new AbortController(); let url = '';
    const timer = setTimeout(() => { controller.abort(); }, 15_000);
    void previewSiteImage(siteId, value, context, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setPreview({ source: value, scope: scopeKey, url });
    }).catch(() => undefined).finally(() => { clearTimeout(timer); });
    return () => { clearTimeout(timer); controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [siteId, value, kind, context, scopeKey]);
  const choose = async (file: File) => {
    if (upload.current) return false;
    if (!file.size || file.size > 4_000_000) { setError(t('websites.assetTooLarge')); return false; }
    const controller = new AbortController(); upload.current = controller; setBusy(true); onUploadState(1); setError('');
    const timer = setTimeout(() => { controller.abort(); }, 30_000);
    try {
      const result = await uploadSiteThemeAsset(siteId, file, kind, context, controller.signal);
      if (controller.signal.aborted || activeScope.current !== scopeKey) return false;
      latest.current(result.source); return true;
    } catch (failure) { if (activeScope.current === scopeKey) setError(apiErrorDetail(failure, t('websites.assetUploadFailed'))); return false; }
    finally { clearTimeout(timer); upload.current = null; onUploadState(-1); setBusy(false); }
  };
  return <div className="websites-asset-picker">
    {kind === 'image' && value && preview.source === value && preview.scope === scopeKey && preview.url && <img className="websites-asset-thumbnail" src={preview.url} alt={label} />}
    {value && <span className="websites-muted websites-asset-name" title={value}>{value.split('/').pop()}</span>}
    <div className="websites-actions"><FileImportButton label={t(value ? 'websites.replaceAsset' : 'websites.uploadAsset', { name: label })} accept={kind === 'font' ? '.woff,.woff2,.ttf,.otf' : '.png,.jpg,.jpeg,.webp,.gif,.ico'} disabled={disabled || busy} onFile={file => { task.current = choose(file); void task.current.finally(() => { task.current = null; }); }} />
      {value && <button type="button" className="websites-button" aria-label={`${t('websites.remove')} ${label}`} disabled={disabled || busy} onClick={() => { latest.current(''); }}>{t('websites.remove')}</button>}
    </div>
    {busy && <span role="status">{t('websites.uploadingAsset')}</span>}{error && <p role="alert" className="websites-error">{error}</p>}
    <p className="websites-muted">{t(kind === 'font' ? 'websites.fontUploadHelp' : 'websites.imageUploadHelp')}</p>
  </div>;
}
