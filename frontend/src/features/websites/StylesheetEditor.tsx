import { useTranslation } from 'react-i18next';
import type { SiteTheme } from '../../shared/api/sites';
import { Card, Disclosure, Field, Textarea } from './components';
import base from '../../../../extensions/web-publishing/renderer/src/lib/styles.css?raw';
import template from '../../../../extensions/web-publishing/renderer/src/lib/temenos.css?raw';
import layout from '../../../../extensions/web-publishing/renderer/src/lib/page-layout.css?raw';

const originals = { base, template, layout };
const keys = ['base', 'template', 'layout'] as const;

export function StylesheetEditor({ theme, disabled, onChange }: { theme: SiteTheme; disabled: boolean; onChange: (theme: SiteTheme) => void }) {
  const { t } = useTranslation();
  const overrides = theme.stylesheet_overrides ?? {};
  return <Card title={t('websites.advancedCss')}>
    <p className="websites-muted">{t('websites.stylesheets.help')}</p>
    <div className="websites-list websites-spacer">{keys.map(key => <Disclosure key={key} title={t(`websites.stylesheets.${key}`)} actions={<button type="button" className="websites-button" disabled={disabled || overrides[key] === undefined} onClick={() => {
      const next = Object.fromEntries(Object.entries(overrides).filter(([name]) => name !== key)); onChange({ ...theme, stylesheet_overrides: next });
    }}>{t('websites.stylesheets.restore')}</button>}>
      <Field label={t(`websites.stylesheets.${key}`)}><Textarea className="websites-code" spellCheck={false} rows={16} maxLength={100000} disabled={disabled} value={overrides[key] ?? originals[key]} onChange={event => { onChange({ ...theme, stylesheet_overrides: { ...overrides, [key]: event.target.value } }); }} /></Field>
    </Disclosure>)}</div>
    <Disclosure title={t('websites.stylesheets.additional')} className="websites-row websites-spacer">
      <p className="websites-muted">{t('websites.cssHelp')}</p>
      <Field label={t('websites.customCss')}><Textarea className="websites-code" spellCheck={false} rows={12} maxLength={100000} disabled={disabled} value={theme.advanced_css} onChange={event => { onChange({ ...theme, advanced_css: event.target.value }); }} /></Field>
    </Disclosure>
  </Card>;
}
