import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MultiSelectPills } from '../../shared/ui/selection/MultiSelectPills';
const COMMON = ['ca', 'es', 'en-gb', 'fr', 'de', 'it', 'pt', 'pt-br', 'eu', 'gl', 'oc', 'ar', 'zh', 'ja', 'ru', 'uk', 'pl', 'nl'];
function languageName(code: string): string {
  try { return `${new Intl.DisplayNames([code], { type: 'language' }).of(code) || code} (${code})`; } catch { return code.toUpperCase(); }
}
export function WebsiteLanguages({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const { t } = useTranslation(); const [error, setError] = useState('');
  const options = useMemo(() => [...new Set([...COMMON, ...value])], [value]);
  const titles = useMemo(() => Object.fromEntries(options.map(code => [code, languageName(code)])), [options]);
  return <div><MultiSelectPills label={t('websites.languages')} value={value} options={options} idToTitle={titles} minimum={1} onChange={selected => {
    const languages = (Array.isArray(selected) ? selected : [selected]).filter((item): item is string => typeof item === 'string');
    if (languages.length) { setError(''); onChange(languages); }
  }} onCreate={raw => { const code = raw.trim().toLowerCase(); if (!/^[a-z]{2,3}(?:-[a-z]{2,8})?$/u.test(code)) { setError(t('websites.invalidLanguageCode')); return; } setError(''); onChange([...new Set([...value, code])]); }} />
    <p className="websites-muted">{t('websites.languageSelectHelp')}</p>{error && <p role="alert" className="websites-error">{error}</p>}
  </div>;
}
