import { useTranslation } from 'react-i18next';
import type { SiteTheme } from '../../shared/api/sites';
import { Card, Disclosure, Field, Input, Select } from './components';
import groups from '../../../../extensions/web-publishing/renderer/src/lib/color-tokens.json';

interface ColorToken { key: string; default?: string; fallback?: string; legacyFallback?: string; optional?: boolean }
interface ColorGroup { id: string; tokens: ColorToken[] }
const COLOR_GROUPS: ColorGroup[] = groups;
const PALETTE = ['primary', 'accent', 'secondary'];

export function WebsiteColors({ theme, legacy, disabled, onChange }: { theme: SiteTheme; legacy: boolean; disabled: boolean; onChange: (theme: SiteTheme) => void }) {
  const { t } = useTranslation();
  const currentTokens = theme.tokens ?? {};
  const update = (key: string, value: string) => {
    const tokens = value ? { ...currentTokens, [key]: value } : Object.fromEntries(Object.entries(currentTokens).filter(([name]) => name !== key));
    onChange({ ...theme, tokens });
  };
  const inherited = (token: ColorToken) => {
    const fallback = legacy ? token.legacyFallback ?? token.fallback : token.fallback;
    const defaults = COLOR_GROUPS.flatMap(group => group.tokens).find(item => item.key === fallback)?.default;
    return (fallback && currentTokens[fallback]) || defaults || token.default || '#ffffff';
  };
  const resolve = (value: string, seen: string[] = []): string => {
    const key = /^var\(--(primary|accent|secondary)\)$/u.exec(value)?.[1];
    if (!key || seen.includes(key)) return value;
    const token = COLOR_GROUPS.flatMap(group => group.tokens).find(item => item.key === key);
    return resolve(currentTokens[key] || token?.default || '#ffffff', [...seen, key]);
  };
  const assignment = (value: string) => PALETTE.find(key => value === `var(--${key})`) ?? (value === '#ffffff' ? 'white' : value === '#000000' ? 'black' : value ? 'custom' : 'inherit');
  return <Card title={t('websites.colors.title')}>
    <p className="websites-muted">{t('websites.colors.help')}</p>
    <div className="websites-list">{COLOR_GROUPS.map(group => <Disclosure key={group.id} title={t(`websites.colors.groups.${group.id}`)}>
      {group.id === 'header' && <p className="websites-muted">{t('websites.colors.logoContrast')}</p>}
      <div className="websites-grid">{group.tokens.map((token: ColorToken) => {
        const value = currentTokens[token.key] ?? '';
        const swatch = resolve(value || inherited(token));
        const label = t(`websites.tokens.${token.key}`);
        const regional = group.id !== 'palette';
        return <Field key={token.key} label={label}>
          {regional && <Select aria-label={t('websites.colors.assignment', { label })} disabled={disabled} value={assignment(value)} onChange={event => {
            const selected = event.target.value;
            update(token.key, selected === 'inherit' ? '' : PALETTE.includes(selected) ? `var(--${selected})` : selected === 'white' ? '#ffffff' : selected === 'black' ? '#000000' : swatch);
          }}>
            <option value="inherit">{t('websites.colors.inherit')}</option>
            {PALETTE.map(key => <option key={key} value={key}>{t(`websites.tokens.${key}`)}</option>)}
            <option value="white">{t('websites.colors.white')}</option><option value="black">{t('websites.colors.black')}</option><option value="custom">{t('websites.colors.custom')}</option>
          </Select>}
          {(!regional || assignment(value) !== 'inherit') && <div className="websites-color">
            {/^#[\da-f]{6}$/iu.test(swatch) && <input type="color" aria-label={t('websites.colors.pick', { label })} disabled={disabled} value={swatch} onChange={event => { update(token.key, event.target.value); }} />}
            {(!regional || assignment(value) === 'custom') && <Input aria-label={label} disabled={disabled} value={value} placeholder={t('websites.colors.inheritedValue', { value: resolve(inherited(token)) })} onChange={event => { update(token.key, event.target.value); }} />}
          </div>}
          {(regional || token.optional) && <button type="button" className="websites-button" disabled={disabled || !value} onClick={() => { update(token.key, ''); }}>{t('websites.colors.reset', { label })}</button>}
        </Field>;
      })}</div>
    </Disclosure>)}</div>
  </Card>;
}
