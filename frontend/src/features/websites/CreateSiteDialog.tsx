import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalKeyboard } from '../../shared/hooks/useModalKeyboard';
import { apiErrorDetail } from '../../shared/api/errors';
import type { WebsiteImportPreview } from '../../shared/api/sites';
import { Field, Input, Select, Toggle } from './components';

interface Props {
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string, importPilot: boolean) => void;
  onReview: (url: string, maxPages: number) => Promise<WebsiteImportPreview>;
  onImport: (previewId: string, name: string, pages: string[]) => void;
}

export function CreateSiteDialog({ busy, onClose, onCreate, onReview, onImport }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const [name, setName] = useState('');
  const [mode, setMode] = useState('blank');
  const [url, setUrl] = useState('');
  const [maxPages, setMaxPages] = useState(20);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<WebsiteImportPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const pending = busy || reviewing;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useModalKeyboard({ isOpen: true, containerRef: ref, onClose, closeOnEscape: !pending });
  const review = async () => {
    if (pending || !url.trim()) return;
    setReviewing(true); setError(''); setPreview(null); setSelected([]);
    try {
      const result = await onReview(url.trim(), maxPages);
      if (!alive.current) return;
      setPreview(result); setSelected(result.pages.map(page => page.id));
      if (!name.trim()) setName(result.name.slice(0, 200));
    } catch (failure) { if (alive.current) setError(apiErrorDetail(failure, t('websites.importFailed'))); }
    finally { if (alive.current) setReviewing(false); }
  };
  return <div ref={ref} className="websites-dialog" role="dialog" aria-modal="true" aria-label={t('websites.createSite')}><form onSubmit={event => {
    event.preventDefault();
    if (pending || !name.trim()) return;
    if (mode === 'blank') onCreate(name.trim(), false);
    else if (preview && selected.length) onImport(preview.id, name.trim(), selected);
  }}>
    <h2>{t('websites.createSite')}</h2>
    <Field label={t('websites.createMode')}><Select value={mode} disabled={pending} onChange={event => { setMode(event.target.value); setError(''); }}><option value="blank">{t('websites.createBlank')}</option><option value="url">{t('websites.importUrl')}</option></Select></Field>
    <Field label={t('websites.siteName')}><Input required autoFocus maxLength={200} value={name} onChange={event => { setName(event.target.value); }} disabled={pending} /></Field>
    {mode === 'url' && <>
      <p className="websites-muted">{t('websites.importUrlHelp')}</p>
      <Field label={t('websites.sourceUrl')}><Input type="url" required value={url} disabled={pending} placeholder="https://example.org" onChange={event => { setUrl(event.target.value); setPreview(null); setSelected([]); }} /></Field>
      <Field label={t('websites.importMaxPages')}><Input type="number" min={1} max={100} value={maxPages} disabled={pending} onChange={event => { setMaxPages(Math.min(100, Math.max(1, event.target.valueAsNumber || 1))); setPreview(null); }} /></Field>
      <button type="button" className="websites-button" disabled={pending || !url.trim()} onClick={() => { void review(); }}>{t(reviewing ? 'websites.importAnalyzing' : 'websites.importReview')}</button>
      {preview && <section aria-label={t('websites.importPages')}>
        <p className="websites-muted">{t('websites.importSummary', { count: preview.pages.length, images: preview.assets_count })}</p>
        <p className="websites-notice">{t('websites.importReviewHelp')}</p>
        {preview.warnings.length > 0 && <ul className="websites-notice">{preview.warnings.map((warning, index) => <li key={`${String(index)}-${warning}`}>{warning}</li>)}</ul>}
        <div className="websites-list">{preview.pages.map(page => <Toggle key={page.id} label={`${page.title} · ${page.language.toUpperCase()} · ${page.path}`} value={selected.includes(page.id)} disabled={pending} onChange={include => { setSelected(previous => include ? [...previous, page.id] : previous.filter(id => id !== page.id)); }} />)}</div>
      </section>}
    </>}
    {error && <p role="alert" className="websites-error">{error}</p>}
    <div className="websites-actions"><button type="button" className="websites-button" disabled={pending} onClick={onClose}>{t('websites.cancel')}</button><button type="submit" className="btn btn-gnosi-primary" disabled={pending || !name.trim() || (mode === 'url' && (!preview || !selected.length))}>{t(mode === 'url' ? 'websites.importSelected' : 'websites.create')}</button></div>
  </form></div>;
}
