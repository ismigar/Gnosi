import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SiteConfig, SiteTheme, SiteFont } from '../../shared/api/sites';
import { Card, Field, Input, Select, FileImportButton } from './components';
import { escaped, safePreviewDocument } from './helpers';
import type { RequestContext } from '../../shared/api/request-context';
import type { RegisterAutosave } from './autosaveRequest';
import { ThemeAssetPicker } from './ThemeAssetPicker';
import { StylesheetEditor } from './StylesheetEditor';
import { FontManager } from './FontManager';
import { useWebsiteFontSamples } from './useWebsiteFontSamples';

const EMPTY_FONTS: SiteFont[] = [];

const TOKENS = ['primary', 'accent', 'background', 'surface', 'text', 'muted', 'content-width', 'reading-width', 'radius', 'spacing'];

export function AppearanceEditor({ site, history, onChange, onExport, onImport, onHistory, busy, context, register }: { register?: RegisterAutosave; context: RequestContext; site: SiteConfig; history: SiteTheme[]; onChange: (site: SiteConfig) => void; onExport: () => void; onImport: (file: File) => void; onHistory: () => void; busy: boolean }) {
  const { t } = useTranslation();
  const [uploads, setUploads] = useState(0);
  const uploadState = useCallback((delta: number) => { setUploads(value => Math.max(0, value + delta)); }, []);
  const theme = site.theme;
  const fonts = theme?.fonts ?? EMPTY_FONTS;
  const samples = useWebsiteFontSamples(site.id, fonts, context);
  if (!theme) return null;
  const update = (patch: Partial<SiteTheme>) => { onChange({ ...site, theme: { ...theme, ...patch } }); };
  return <div className="websites-panel websites-appearance"><Card title={t('websites.brand')} actions={<div className="websites-actions"><button type="button" className="websites-button" disabled={busy || uploads > 0} onClick={onExport}>{t('websites.exportTheme')}</button><FileImportButton label={t('websites.importTheme')} accept="application/json,.json" disabled={busy || uploads > 0} onFile={onImport} /></div>}>
    <div className="websites-grid"><Field label={t('websites.themeName')}><Input value={theme.name} onChange={event => { update({ name: event.target.value }); }} /></Field><Field label={t('websites.logo')}><ThemeAssetPicker register={register} onUploadState={uploadState} revision={site.revision} siteId={site.id} context={context} assetKey="logo" label={t('websites.logo')} kind="image" value={theme.logo} disabled={busy || uploads > 0} onChange={logo => { update({ logo }); }} /></Field><Field label={t('websites.logoAlt')}><Input value={theme.logo_alt} onChange={event => { update({ logo_alt: event.target.value }); }} /></Field><Field label={t('websites.favicon')}><ThemeAssetPicker register={register} onUploadState={uploadState} revision={site.revision} siteId={site.id} context={context} assetKey="favicon" label={t('websites.favicon')} kind="image" value={theme.favicon} disabled={busy || uploads > 0} onChange={favicon => { update({ favicon }); }} /></Field>
      {TOKENS.map(token => { const value = theme.tokens?.[token] ?? ''; return <Field key={token} label={t(`websites.tokens.${token}`)}><div className="websites-color">{/^#[\da-f]{6}$/iu.test(value) && <input type="color" aria-label={t(`websites.tokens.${token}`)} value={value} onChange={event => { update({ tokens: { ...theme.tokens, [token]: event.target.value } }); }} />}<Input aria-label={t(`websites.tokens.${token}`)} value={value} onChange={event => { update({ tokens: { ...theme.tokens, [token]: event.target.value } }); }} /></div></Field>; })}
    </div></Card><FontManager siteId={site.id} revision={site.revision} theme={theme} disabled={busy || uploads > 0} context={context} register={register} aliases={samples.aliases} sampleFailed={samples.failed} onUploadState={uploadState} onChange={theme => { onChange({ ...site, theme }); }} /><StylesheetEditor theme={theme} disabled={busy} onChange={theme => { onChange({ ...site, theme }); }} />
    <Card title={t('websites.themeHistory')} actions={<button type="button" className="websites-button" disabled={busy || uploads > 0} onClick={onHistory}>{t('websites.loadHistory')}</button>}><div className="websites-list">{history.map((version, index) => <div key={index} className="websites-row-title"><span>{version.name} · {t('websites.version', { count: index + 1 })}</span><button type="button" className="websites-button" disabled={busy || uploads > 0} onClick={() => { onChange({ ...site, theme: version }); }}>{t('websites.useTheme')}</button></div>)}</div></Card>
  </div>;
}

export function WebsitePreview({ url, html, title }: { url?: string | null; html?: string; title: string }) {
  const { t } = useTranslation();
  const [width, setWidth] = useState('desktop');
  const safeUrl = url && /^https?:\/\//iu.test(url) ? url : undefined;
  return <Card title={title} actions={<div className="websites-actions"><Field label={t('websites.previewSize')}><Select value={width} onChange={event => { setWidth(event.target.value); }}>{['desktop', 'tablet', 'mobile'].map(value => <option key={value} value={value}>{t(`websites.sizes.${value}`)}</option>)}</Select></Field>{safeUrl && <a className="websites-button" href={safeUrl} target="_blank" rel="noopener noreferrer">{t('websites.openPreview')}</a>}</div>}><div className="websites-preview" data-width={width}><iframe title={title} sandbox="" referrerPolicy="no-referrer" src={safeUrl} srcDoc={html ? safePreviewDocument(html) : safeUrl ? undefined : safePreviewDocument(`<p>${escaped(t('websites.previewHelp'))}</p>`)} /></div></Card>;
}
