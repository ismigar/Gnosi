import { useTranslation } from 'react-i18next';
import type { SiteFont, SiteTheme, SiteThemeAsset } from '../../shared/api/sites';
import type { RequestContext } from '../../shared/api/request-context';
import type { RegisterAutosave } from './autosaveRequest';
import { Card, Disclosure, Field, Select } from './components';
import { ThemeAssetPicker } from './ThemeAssetPicker';
import { RemoteFontPicker } from './RemoteFontPicker';
import { TypographyPicker } from './TypographyPicker';

const fontKeys = ['font-body', 'font-heading'] as const;
const defaults = { 'font-body': 'Georgia, serif', 'font-heading': 'system-ui, sans-serif' };
const primaryFamily = (value: string) => value.split(',')[0]?.trim().replace(/^['"]|['"]$/gu, '') || value;

export function FontManager({ siteId, revision, theme, disabled, context, register, aliases, sampleFailed, onChange, onUploadState }: { siteId: string; revision: number; theme: SiteTheme; disabled: boolean; context: RequestContext; register?: RegisterAutosave; aliases: Readonly<Record<string, string>>; sampleFailed: boolean; onChange: (theme: SiteTheme) => void; onUploadState: (delta: number) => void }) {
  const { t } = useTranslation();
  const fonts = theme.fonts ?? [];
  const setPrimary = (key: typeof fontKeys[number], family: string) => {
    const previous = theme.tokens?.[key] || defaults[key];
    const fallback = previous.split(',').slice(1).join(',').trim() || 'sans-serif';
    return `${JSON.stringify(family)}, ${fallback}`;
  };
  const received = (asset: SiteThemeAsset, file: File, replacement?: SiteFont) => {
    const family = file.name.replace(/\.[^.]+$/u, '').replace(/[^\p{L}\p{N}_ -]/gu, ' ').trim().slice(0, 100) || t('websites.newFont');
    const font: SiteFont = asset.font ?? { family, src: asset.source, weight: '400', style: 'normal' };
    if (!replacement && fonts.some(item => item.src === font.src && item.family === font.family && item.weight === font.weight && item.style === font.style)) return;
    const next = replacement ? fonts.map(item => item === replacement ? font : item) : [...fonts, font];
    const tokens = { ...theme.tokens };
    if (replacement && replacement.family !== font.family && !next.some(item => item.family === replacement.family)) {
      for (const key of fontKeys) if (primaryFamily(tokens[key] || '') === replacement.family) tokens[key] = setPrimary(key, font.family);
    }
    onChange({ ...theme, fonts: next, tokens });
  };
  const remove = (font: SiteFont) => {
    const next = fonts.filter(item => item !== font); const tokens = { ...theme.tokens };
    if (!next.some(item => item.family === font.family)) for (const key of fontKeys) if (primaryFamily(tokens[key] || '') === font.family) tokens[key] = defaults[key];
    onChange({ ...theme, fonts: next, tokens });
  };
  return <Card title={t('websites.fontLibrary')}>
    <p className="websites-muted">{t('websites.fontManagerHelp')}</p>
    <div className="websites-grid websites-spacer">{fontKeys.map(key => <Field key={key} label={t(`websites.tokens.${key}`)}><TypographyPicker label={t(`websites.tokens.${key}`)} value={theme.tokens?.[key] || defaults[key]} fonts={fonts} aliases={aliases} disabled={disabled} onChange={value => { onChange({ ...theme, tokens: { ...theme.tokens, [key]: value } }); }} /></Field>)}</div>
    <p className="websites-muted">{t('websites.fontPickerHelp')}</p>
    {sampleFailed && <p role="status" className="websites-muted">{t('websites.fontSampleUnavailable')}</p>}
    <RemoteFontPicker siteId={siteId} context={context} register={register} disabled={disabled} onUploadState={onUploadState} onImported={incoming => { const added = incoming.filter(font => !fonts.some(item => item.family === font.family && item.weight === font.weight && item.style === font.style && item.src === font.src)); if (added.length) onChange({ ...theme, fonts: [...fonts, ...added] }); }} />
    <ThemeAssetPicker siteId={siteId} revision={revision} context={context} register={register} assetKey="new-font" label={t('websites.fontFile')} kind="font" value="" compact buttonLabel={t('websites.importFont')} disabled={disabled} onChange={() => undefined} onUploaded={(asset, file) => { received(asset, file); }} onUploadState={onUploadState} />
    <div className="websites-list websites-spacer">{fonts.map((font, index) => <Disclosure key={`${String(index)}:${font.src}`} title={font.family}>
      <p className="websites-font-sample" style={{ fontFamily: aliases[font.family] || JSON.stringify(font.family), fontWeight: font.weight, fontStyle: font.style, fontSize: '1.5rem' }}>{t('websites.fontSampleText')}</p>
      <div className="websites-actions">{fontKeys.map(key => <button type="button" key={key} className="websites-button" disabled={disabled} onClick={() => { onChange({ ...theme, tokens: { ...theme.tokens, [key]: setPrimary(key, font.family) } }); }}>{t(key === 'font-body' ? 'websites.useFontBody' : 'websites.useFontHeading')}</button>)}</div>
      <ThemeAssetPicker siteId={siteId} revision={revision} context={context} register={register} assetKey={`font-${String(index)}`} label={t('websites.fontFile')} kind="font" value={font.src} compact buttonLabel={t('websites.replaceFont')} disabled={disabled} onChange={() => undefined} onUploaded={(asset, file) => { received(asset, file, font); }} onUploadState={onUploadState} />
      <Disclosure title={t('websites.fontOptions')} className="websites-row websites-spacer"><div className="websites-grid">
        <Field label={t('websites.fontWeight')}><Select disabled={disabled} value={font.weight} onChange={event => { onChange({ ...theme, fonts: fonts.map(item => item === font ? { ...item, weight: event.target.value } : item) }); }}>{[...new Set(['100', '200', '300', '400', '500', '600', '700', '800', '900', font.weight])].map(weight => <option key={weight} value={weight}>{weight}</option>)}</Select></Field>
        <Field label={t('websites.fontStyle')}><Select disabled={disabled} value={font.style} onChange={event => { onChange({ ...theme, fonts: fonts.map(item => item === font ? { ...item, style: event.target.value as SiteFont['style'] } : item) }); }}><option value="normal">{t('websites.normal')}</option><option value="italic">{t('websites.italic')}</option></Select></Field>
      </div></Disclosure>
      <button type="button" className="websites-button websites-spacer" disabled={disabled} onClick={() => { remove(font); }}>{t('websites.remove')}</button>
    </Disclosure>)}</div>
  </Card>;
}
