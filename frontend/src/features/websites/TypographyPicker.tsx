import { useTranslation } from 'react-i18next';
import { type SiteFont } from '../../shared/api/sites';
import { MultiSelectPills } from '../../shared/ui/selection/MultiSelectPills';
import type { PropertyScalar } from '../../shared/ui/selection/types';

const primaryFamily = (value: string) => value.split(',')[0]?.trim().replace(/^['"]|['"]$/gu, '') || value;

export function TypographyPicker({ label, value, fonts, aliases, onChange }: { label: string; value: string; fonts: readonly SiteFont[]; aliases: Readonly<Record<string, string>>; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const options = new Map<string, string>([
    ['system-ui, sans-serif', t('websites.fontSystem')], ['serif', t('websites.fontSerif')],
    ['sans-serif', t('websites.fontSans')], ['monospace', t('websites.fontMono')],
  ]);
  const fallback = value.includes(',') ? value.slice(value.indexOf(',') + 1).trim() : 'sans-serif';
  for (const family of [...new Set(fonts.filter(font => font.src).map(font => font.family).filter(Boolean))].sort()) {
    options.set(primaryFamily(value) === family ? value : `${JSON.stringify(family)}, ${fallback}`, family);
  }
  if (value && !options.has(value)) options.set(value, primaryFamily(value));
  const titles = Object.fromEntries(options);
  const sample = (item: PropertyScalar) => {
    const css = String(item ?? '');
    return <span className="websites-font-sample" style={{ fontFamily: (Object.hasOwn(aliases, primaryFamily(css)) ? aliases[primaryFamily(css)] : css) }} title={titles[css]}>{titles[css] || css}</span>;
  };
  return <MultiSelectPills single label={label} value={value} options={[...options.keys()]} idToTitle={titles} placeholder={t('websites.chooseFont')} emptyMessage={t('websites.fontNotFound')} renderValue={sample} renderOption={sample} onChange={next => { if (typeof next === 'string' && next) onChange(next); }} />;
}
