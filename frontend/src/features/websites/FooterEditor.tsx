import { useTranslation } from 'react-i18next';
import type { CatalogueItem, SiteBlock, SiteConfig, SiteFooterColumn } from '../../shared/api/sites';
import { Card, Field, Input, ReorderActions, Select, Disclosure } from './components';
import { BlocksEditor } from './PagesEditor';
import { moveItem, newId } from './helpers';

const legal = (link: { label: string; href: string }) => /legal|privac|privaci|galetes|cookies/iu.test(`${link.label} ${link.href}`);
const collaborate = (link: { label: string; href: string }) => /col.?labora|colaborar|collaborate|support|donat/iu.test(`${link.label} ${link.href}`);
function block(type: SiteBlock['type']): SiteBlock {
  return { id: newId('footer-block'), type, title: '', body: '', image: '', alt: '', image_position: 'right', columns: 3, limit: 3, href: '', css: '' };
}
function defaults(site: SiteConfig): SiteFooterColumn[] {
  const links = site.footer ?? [];
  const maps = (site.languages ?? []).flatMap(language => [{ label: ({ ca: 'Mapa del web', es: 'Mapa del sitio', fr: 'Plan du site' } as Record<string, string>)[language] ?? 'Site map', href: `/${language}/mapa-web`, language }, { label: 'RSS', href: `/${language}/rss.xml`, language }]);
  return [
    { id: newId('footer-column'), title: '', language: null, alignment: 'left', blocks: [{ ...block('links'), links: [...links.filter(link => !legal(link) && !collaborate(link)), ...maps] }] },
    { id: newId('footer-column'), title: '', language: null, alignment: 'center', blocks: [{ ...block('links'), links: links.filter(collaborate) }] },
    { id: newId('footer-column'), title: '', language: null, alignment: 'right', blocks: [block('social')] },
  ];
}

export function FooterEditor({ site, catalogue, onChange }: { site: SiteConfig; catalogue: CatalogueItem[]; onChange: (site: SiteConfig) => void }) {
  const { t } = useTranslation();
  const columns = site.footer_columns ?? [];
  const custom = site.footer_columns != null;
  const changeColumn = (index: number, patch: Partial<SiteFooterColumn>) => { onChange({ ...site, footer_columns: columns.map((column, at) => at === index ? { ...column, ...patch } : column) }); };
  return <Card title={t('websites.footerLayout')}>
    <Field label={t('websites.footerCopyright')}><Input value={site.footer_copyright ?? `© ${site.name}`} onChange={event => { onChange({ ...site, footer_copyright: event.target.value }); }} /></Field>
    {!custom && <button type="button" className="websites-button" onClick={() => { onChange({ ...site, footer_columns: defaults(site), footer_blocks: site.legacy_pilot ? [block('newsletter')] : [] }); }}>{t('websites.customFooter')}</button>}
    {custom && <>
      <Disclosure title={t('websites.footerWideBlocks')}>
      <BlocksEditor key={`${site.id}:footer-wide`} site={site} catalogue={catalogue} blocks={site.footer_blocks ?? []} onChange={footer_blocks => { onChange({ ...site, footer_blocks }); }} /></Disclosure>
      <Disclosure title={t('websites.columns')} actions={<button type="button" className="websites-button" disabled={columns.length >= 12} onClick={() => { onChange({ ...site, footer_columns: [...columns, { id: newId('footer-column'), title: '', alignment: 'left', language: null, blocks: [] }] }); }}>{t('websites.addColumn')}</button>}>
      <div className="websites-list">{columns.map((column, index) => <Disclosure className="websites-row websites-footer-column" key={column.id} title={`${t('websites.columns')} ${String(index + 1)}`}>
        <div className="websites-row-title"><ReorderActions index={index} length={columns.length} move={offset => { onChange({ ...site, footer_columns: moveItem(columns, index, offset) }); }} remove={() => { onChange({ ...site, footer_columns: columns.filter((_, at) => at !== index) }); }} /></div>
        <div className="websites-grid"><Field label={t('websites.titleLabel')}><Input value={column.title} onChange={event => { changeColumn(index, { title: event.target.value }); }} /></Field><Field label={t('websites.language')}><Select value={column.language ?? ''} onChange={event => { changeColumn(index, { language: event.target.value || null }); }}><option value="">{t('websites.allLanguages')}</option>{(site.languages ?? []).map(language => <option key={language} value={language}>{language.toUpperCase()}</option>)}</Select></Field><Field label={t('websites.visual.alignment')}><Select value={column.alignment} onChange={event => { changeColumn(index, { alignment: event.target.value as SiteFooterColumn['alignment'] }); }}>{['left', 'center', 'right'].map(value => <option key={value} value={value}>{t(`websites.visual.${value}`)}</option>)}</Select></Field></div>
        <BlocksEditor site={site} catalogue={catalogue} blocks={column.blocks ?? []} onChange={blocks => { changeColumn(index, { blocks }); }} />
      </Disclosure>)}</div></Disclosure>
    </>}
  </Card>;
}
