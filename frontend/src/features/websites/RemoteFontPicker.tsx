import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { importSiteFonts, siteFontCatalogue, type SiteFont } from '../../shared/api/sites';
import type { RequestContext } from '../../shared/api/request-context';
import { apiErrorDetail } from '../../shared/api/errors';
import { MultiSelectPills } from '../../shared/ui/selection/MultiSelectPills';
import { useAutosaveRegistration, type RegisterAutosave } from './autosaveRequest';
import { Disclosure, Field, Input } from './components';

type Entry = { id: string; family: string; provider: string; license_url: string };
export function RemoteFontPicker({ siteId, context, register, disabled, onImported, onUploadState }: { siteId: string; context: RequestContext; register?: RegisterAutosave; disabled: boolean; onImported: (fonts: SiteFont[]) => void; onUploadState: (delta: number) => void }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<Entry[]>([]); const [chosen, setChosen] = useState(''); const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const scope = JSON.stringify([siteId, context.userId, context.userEmail, context.workspaceId, context.vaultId]);
  const active = useRef(scope); const latest = useRef(onImported); const controller = useRef<AbortController | null>(null); const task = useRef<Promise<boolean> | null>(null);
  useLayoutEffect(() => { active.current = scope; latest.current = onImported; }, [scope, onImported]);
  useEffect(() => () => { controller.current?.abort(); }, [scope]);
  useEffect(() => {
    const abort = new AbortController(); const timer = setTimeout(() => { abort.abort(); }, 15_000); void Promise.resolve().then(() => { if (!abort.signal.aborted) { setLoading(true); setEntries([]); setChosen(''); } });
    void siteFontCatalogue(context, abort.signal).then(result => { if (!abort.signal.aborted) { setEntries(result); setError(''); } }).catch(() => { if (active.current === scope) setError(t('websites.fontCatalogueFailed')); }).finally(() => { clearTimeout(timer); if (active.current === scope) setLoading(false); });
    return () => { clearTimeout(timer); abort.abort(); };
  }, [context, scope, t]);
  const flush = useCallback(() => task.current ?? Promise.resolve(true), []);
  useAutosaveRegistration(register, `remote-font:${siteId}`, busy, flush);
  const start = (source: { url: string } | { catalogue_id: string }) => {
    if (controller.current || disabled) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setError(''); onUploadState(1);
    const timer = setTimeout(() => { abort.abort(); }, 60_000);
    task.current = importSiteFonts(siteId, source, context, abort.signal).then(fonts => {
      if (abort.signal.aborted || active.current !== scope) return false;
      latest.current(fonts); setUrl(''); setChosen(''); return true;
    }).catch((failure: unknown) => { if (active.current === scope) setError(apiErrorDetail(failure, t('websites.assetUploadFailed'))); return false; }).finally(() => {
      clearTimeout(timer); controller.current = null; task.current = null; onUploadState(-1); if (active.current === scope) setBusy(false);
    });
  };
  const selected = entries.find(entry => entry.id === chosen);
  return <Disclosure title={t('websites.fontCatalogue')}>
    <p className="websites-muted">{t('websites.fontCatalogueHelp')}</p>
    <Field label={t('websites.chooseFont')}><MultiSelectPills single label={t('websites.chooseFont')} value={chosen} options={entries.map(entry => entry.id)} idToTitle={Object.fromEntries(entries.map(entry => [entry.id, `${entry.family} · ${entry.provider}`]))} disabled={disabled || busy || loading} placeholder={t('websites.chooseFont')} emptyMessage={t('websites.fontNotFound')} onChange={value => { if (typeof value === 'string') setChosen(value); }} /></Field>
    <div className="websites-actions websites-spacer"><button type="button" className="websites-button" disabled={disabled || busy || !chosen} onClick={() => { start({ catalogue_id: chosen }); }}>{t('websites.addFont')}</button>{selected && <a href={selected.license_url} target="_blank" rel="noopener noreferrer">{t('websites.fontLicense')}</a>}</div>
    <Disclosure title={t('websites.importGoogleFont')} className="websites-row websites-spacer">
      <Field label={t('websites.googleFontUrl')}><Input type="url" value={url} disabled={disabled || busy} placeholder="https://fonts.google.com/specimen/Roboto" onChange={event => { setUrl(event.target.value); }} /></Field>
      <button type="button" className="websites-button websites-spacer" disabled={disabled || busy || !url.trim()} onClick={() => { start({ url: url.trim() }); }}>{t('websites.importFontUrl')}</button>
    </Disclosure>
    {(busy || loading) && <p role="status">{t(busy ? 'websites.uploadingAsset' : 'websites.loading')}</p>}{error && <p role="alert" className="websites-error">{error}</p>}
  </Disclosure>;
}
