import { CURRENCIES } from './formatting';
import { DATE_FORMATS } from './formatting';
import { DECIMAL_SYMBOLS } from './formatting';
import { FormGroup } from '../../../shared/ui/settings/SettingsPrimitives';
import { Globe } from 'lucide-react';
import { Section } from '../../../shared/ui/settings/SettingsPrimitives';
import { availableLocales } from '../../../shared/i18n/locales/registry';
import { resolveLocale } from '../../../shared/i18n/locales/registry';
import { changeI18nLanguage } from '../../../shared/i18n/i18n';
import type { SettingsController } from './useGlobalSettingsController';

type Props = { context: Pick<SettingsController, 'activeTab' | 'draft' | 'i18n' | 'setDraft' | 't' | 'tn'> };

export function LanguagePanel({ context }: Props) {
  const { activeTab, draft, setDraft, t, tn } = context;
  return (activeTab === 'language' && (
    <Section title={tn('language.section_title')} icon={Globe}>
      <FormGroup label={tn('language.select_language')} description={tn('language.select_language_desc')}>
        <select className="gnosi-select" value={resolveLocale(draft.settings.language)} onChange={e => {
          const code = e.target.value;
          setDraft({ ...draft, settings: { ...draft.settings, language: code } });
          void changeI18nLanguage(code);
        }}>
          {availableLocales.map(locale => (
            <option key={locale.code} value={locale.code}>{locale.nativeName}</option>
          ))}
        </select>
      </FormGroup>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', borderTop: '1px solid var(--settings-border)', paddingTop: '44px' }}>
        <FormGroup label={tn('language.first_day')}>
          <select className="gnosi-select" value={draft.settings.week_start} onChange={e => { setDraft({ ...draft, settings: { ...draft.settings, week_start: parseInt(e.target.value) } }); }}>
            <option value={1}>{tn('language.monday_iso')}</option>
            <option value={0}>{tn('language.sunday_us')}</option>
          </select>
        </FormGroup>
        <FormGroup label={tn('language.currency_ref')}>
          <select className="gnosi-select" value={draft.settings.currency} onChange={e => { setDraft({ ...draft, settings: { ...draft.settings, currency: e.target.value } }); }}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </FormGroup>
        <FormGroup label={tn('language.decimal_symbol_label')}>
          <select className="gnosi-select" value={draft.settings.decimal_symbol} onChange={e => { setDraft({ ...draft, settings: { ...draft.settings, decimal_symbol: e.target.value } }); }}>
            {DECIMAL_SYMBOLS.map(s => <option key={s} value={s}>{s === ',' ? tn('language.decimal_comma') : tn('language.decimal_point')}</option>)}
          </select>
        </FormGroup>
        <FormGroup label={tn('language.date_format_label')} description={tn('language.date_format_desc')}>
          <select className="gnosi-select" value={draft.settings.date_format || 'locale'} onChange={e => { setDraft({ ...draft, settings: { ...draft.settings, date_format: e.target.value } }); }}>
            {DATE_FORMATS.map(f => <option key={f.value} value={f.value}>{t(f.labelKey)}</option>)}
          </select>
        </FormGroup>
      </div>
    </Section>
  ));
}
