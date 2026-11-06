import { WebsiteLanguages } from './WebsiteLanguages';
import { useTranslation } from 'react-i18next';
import type { SiteConfig } from '../../shared/api/sites';
import { Card, Field, Input, Select } from './components';
import { LinksEditor } from './LinksEditor';
import { SocialLinksEditor } from './SocialLinksEditor';

export function NavigationEditor({ site, onChange }: { site: SiteConfig; onChange: (site: SiteConfig) => void }) {
  const { t } = useTranslation();
  return <div className="websites-panel"><Card title={t('websites.siteSettings')}><div className="websites-grid"><Field label={t('websites.siteName')}><Input value={site.name} onChange={event => { onChange({ ...site, name: event.target.value }); }} /></Field><Field label={t('websites.origin')}><Input type="url" value={site.origin} onChange={event => { onChange({ ...site, origin: event.target.value }); }} /></Field><Field label={t('websites.languages')}><WebsiteLanguages value={site.languages ?? []} onChange={languages => { onChange({ ...site, languages, default_language: languages.includes(site.default_language) ? site.default_language : languages[0] ?? '' }); }} /></Field><Field label={t('websites.defaultLanguage')}><Select value={site.default_language} onChange={event => { onChange({ ...site, default_language: event.target.value }); }}>{(site.languages ?? []).map(language => <option key={language} value={language}>{language.toUpperCase()}</option>)}</Select></Field></div></Card>
    <LinksEditor title={t('websites.navigation')} links={site.navigation ?? []} languages={site.languages ?? []} onChange={navigation => { onChange({ ...site, navigation }); }} />
    <LinksEditor title={t('websites.headerActions')} links={site.header_actions ?? []} languages={site.languages ?? []} defaultAppearance="button" onChange={header_actions => { onChange({ ...site, header_actions }); }} />
    <LinksEditor title={t('websites.footer')} links={site.footer ?? []} languages={site.languages ?? []} onChange={footer => { onChange({ ...site, footer }); }} />
    <SocialLinksEditor site={site} onChange={onChange} />
    <Card title={t('websites.redirects')} actions={<button type="button" className="websites-button" onClick={() => { const key = `/old-${String(Object.keys(site.redirects ?? {}).length + 1)}`; onChange({ ...site, redirects: { ...site.redirects, [key]: '/' } }); }}>{t('websites.addRedirect')}</button>}><div className="websites-list">{Object.entries(site.redirects ?? {}).map(([path, destination], index) => <div className="websites-grid" key={index}><Field label={t('websites.oldPath')}><Input value={path} onChange={event => { onChange({ ...site, redirects: Object.fromEntries(Object.entries(site.redirects ?? {}).map(([key, value]) => key === path ? [event.target.value, value] : [key, value])) }); }} /></Field><Field label={t('websites.destination')}><Input value={destination} onChange={event => { onChange({ ...site, redirects: { ...site.redirects, [path]: event.target.value } }); }} /></Field><button type="button" className="websites-button" onClick={() => { onChange({ ...site, redirects: Object.fromEntries(Object.entries(site.redirects ?? {}).filter(([key]) => key !== path)) }); }}>{t('websites.remove')}</button></div>)}</div></Card>
  </div>;
}
