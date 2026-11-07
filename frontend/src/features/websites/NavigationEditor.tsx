import { WebsiteLanguages } from './WebsiteLanguages';
import { useTranslation } from 'react-i18next';
import type { SiteConfig, CatalogueItem } from '../../shared/api/sites';
import { Card, Field, Input, Select } from './components';
import { LinksEditor } from './LinksEditor';
import { SocialLinksEditor } from './SocialLinksEditor';
import { FooterEditor } from './FooterEditor';
import { RegionsEditor } from './RegionsEditor';

export function NavigationEditor({ site, onChange, catalogue = [], section = 'menus' }: { section?: 'configuration' | 'menus' | 'regions'; catalogue?: CatalogueItem[]; site: SiteConfig; onChange: (site: SiteConfig) => void }) {
  const { t } = useTranslation();
  return <div className="websites-panel">{section === 'configuration' && <Card title={t('websites.siteSettings')}><div className="websites-grid"><Field label={t('websites.siteName')}><Input value={site.name} onChange={event => { onChange({ ...site, name: event.target.value }); }} /></Field><Field label={t('websites.origin')}><Input type="url" value={site.origin} onChange={event => { onChange({ ...site, origin: event.target.value }); }} /></Field><Field label={t('websites.languages')}><WebsiteLanguages value={site.languages ?? []} onChange={languages => { onChange({ ...site, languages, default_language: languages.includes(site.default_language) ? site.default_language : languages[0] ?? '' }); }} /></Field><Field label={t('websites.defaultLanguage')}><Select value={site.default_language} onChange={event => { onChange({ ...site, default_language: event.target.value }); }}>{(site.languages ?? []).map(language => <option key={language} value={language}>{language.toUpperCase()}</option>)}</Select></Field></div></Card>}
    {section === 'menus' && <LinksEditor title={t('websites.navigation')} links={site.navigation ?? []} languages={site.languages ?? []} onChange={navigation => { onChange({ ...site, navigation }); }} />}
    {section === 'regions' && <LinksEditor title={t('websites.headerActions')} links={site.header_actions ?? []} languages={site.languages ?? []} defaultAppearance="button" onChange={header_actions => { onChange({ ...site, header_actions }); }} />}
    {section === 'menus' && site.footer_columns == null && <LinksEditor title={t('websites.footer')} links={site.footer ?? []} languages={site.languages ?? []} onChange={footer => { onChange({ ...site, footer }); }} />}
    {section === 'menus' && <LinksEditor title={t('websites.footerBottomLinks')} languages={site.languages} links={site.footer_bottom_links ?? (site.footer ?? []).filter(link => /legal|privac|privaci|galetes|cookies/iu.test(`${link.label} ${link.href}`))} onChange={footer_bottom_links => { onChange({ ...site, footer_bottom_links }); }} />}
    {section === 'regions' && <><RegionsEditor site={site} catalogue={catalogue} onChange={onChange} /><FooterEditor site={site} catalogue={catalogue} onChange={onChange} /></>}
    {section === 'regions' && <SocialLinksEditor site={site} onChange={onChange} />}
    {section === 'configuration' && <Card title={t('websites.redirects')} actions={<button type="button" className="websites-button" onClick={() => { const key = `/old-${String(Object.keys(site.redirects ?? {}).length + 1)}`; onChange({ ...site, redirects: { ...site.redirects, [key]: '/' } }); }}>{t('websites.addRedirect')}</button>}><div className="websites-list">{Object.entries(site.redirects ?? {}).map(([path, destination], index) => <div className="websites-grid" key={index}><Field label={t('websites.oldPath')}><Input value={path} onChange={event => { onChange({ ...site, redirects: Object.fromEntries(Object.entries(site.redirects ?? {}).map(([key, value]) => key === path ? [event.target.value, value] : [key, value])) }); }} /></Field><Field label={t('websites.destination')}><Input value={destination} onChange={event => { onChange({ ...site, redirects: { ...site.redirects, [path]: event.target.value } }); }} /></Field><button type="button" className="websites-button" onClick={() => { onChange({ ...site, redirects: Object.fromEntries(Object.entries(site.redirects ?? {}).filter(([key]) => key !== path)) }); }}>{t('websites.remove')}</button></div>)}</div></Card>}
  </div>;
}
