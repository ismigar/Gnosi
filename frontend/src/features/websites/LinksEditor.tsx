import { useTranslation } from 'react-i18next';
import type { NavigationLink } from '../../shared/api/sites';
import { Card, Field, Input, ReorderActions, Select } from './components';
import { WebsiteFileField } from './WebsiteFileField';
import { moveItem } from './helpers';

type LinkAppearance = NonNullable<NavigationLink['appearance']>;

export function LinksEditor({ title, links, languages, showAppearance = true, defaultAppearance = 'link', onChange }: {
  title: string;
  links: NavigationLink[];
  languages?: string[];
  showAppearance?: boolean;
  defaultAppearance?: LinkAppearance;
  onChange: (links: NavigationLink[]) => void;
}) {
  const { t } = useTranslation();
  const update = (index: number, patch: Partial<NavigationLink>) => {
    onChange(links.map((link, position) => position === index ? { ...link, ...patch } : link));
  };
  const add = () => {
    onChange([...links, { label: '', href: '', language: null, ...(showAppearance ? { appearance: defaultAppearance } : {}) }]);
  };
  return <Card title={title} actions={<button type="button" className="websites-button" onClick={add}>{t('websites.addLink')}</button>}>
    <div className="websites-list">{links.map((link, index) => <div className="websites-row" key={index}>
      <div className="websites-grid">
        <Field label={t('websites.label')}><Input value={link.label} onChange={event => { update(index, { label: event.target.value }); }} /></Field>
        <Field label={t('websites.destination')}><WebsiteFileField label={t('websites.destination')} value={link.href} onChange={href => { update(index, { href }); }} /></Field>
        {languages && <Field label={t('websites.language')}><Select value={link.language ?? ''} onChange={event => { update(index, { language: event.target.value || null }); }}>
          <option value="">{t('websites.allLanguages')}</option>
          {languages.map(language => <option key={language} value={language}>{language.toUpperCase()}</option>)}
        </Select></Field>}
        {showAppearance && <Field label={t('websites.linkAppearance')}><Select value={link.appearance ?? 'link'} onChange={event => { update(index, { appearance: event.target.value as LinkAppearance }); }}>
          {(['link', 'button', 'outline'] as const).map(appearance => <option key={appearance} value={appearance}>{t(`websites.linkAppearances.${appearance}`)}</option>)}
        </Select></Field>}
      </div>
      <div className="websites-spacer"><ReorderActions index={index} length={links.length} move={direction => { onChange(moveItem(links, index, direction)); }} remove={() => { onChange(links.filter((_, position) => position !== index)); }} /></div>
    </div>)}</div>
  </Card>;
}
