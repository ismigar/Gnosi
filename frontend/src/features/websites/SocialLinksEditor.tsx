import { useTranslation } from 'react-i18next';
import type { SiteConfig, NavigationLink } from '../../shared/api/sites';
import networks from '../../../../extensions/web-publishing/renderer/src/icons/social/networks.json';
import { Card, Input } from './components';
import { LinksEditor } from './LinksEditor';

const icons = import.meta.glob<string>('../../../../extensions/web-publishing/renderer/src/icons/social/*.svg', { eager: true, query: '?url', import: 'default' });
const networkFor = (link: NavigationLink) => networks.find(network => network.aliases.includes(link.label.toLowerCase().trim()));

export function SocialLinksEditor({ site, onChange }: { site: SiteConfig; onChange: (site: SiteConfig) => void }) {
  const { t } = useTranslation();
  const links = site.social_links ?? [];
  const custom = links.filter(link => !networkFor(link));
  const change = (id: string, href: string) => {
    const network = networks.find(item => item.id === id);
    if (!network) return;
    const matches = links.some(link => networkFor(link)?.id === id);
    const social_links = links.flatMap(link => networkFor(link)?.id !== id ? [link] : href.trim() ? [{ ...link, href }] : []);
    if (!matches && href.trim()) social_links.push({ label: network.name, href, language: null });
    onChange({ ...site, social_links });
  };
  return <Card title={t('websites.social_links')}><div className="websites-grid">{networks.map(network => {
    const source = Object.entries(icons).find(([path]) => path.endsWith(`/${network.icon}.svg`))?.[1];
    return <label className="websites-field" key={network.id}><span className="websites-social-label"><span aria-hidden="true" className="websites-social-icon" style={{ maskImage: `url("${source ?? ''}")`, WebkitMaskImage: `url("${source ?? ''}")` }} />{network.name}</span><Input type="url" aria-label={network.name} placeholder="https://…" value={links.find(link => networkFor(link)?.id === network.id)?.href ?? ''} onChange={event => { change(network.id, event.target.value); }} /></label>;
  })}</div><details className="websites-spacer"><summary>{t('websites.otherSocialNetworks')}</summary><LinksEditor title={t('websites.otherSocialNetworks')} links={custom} showAppearance={false} onChange={next => { onChange({ ...site, social_links: [...links.filter(link => networkFor(link)), ...next] }); }} /></details></Card>;
}
