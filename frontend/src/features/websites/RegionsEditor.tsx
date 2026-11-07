import { useTranslation } from 'react-i18next';
import type { CatalogueItem, SiteConfig, SiteRegion } from '../../shared/api/sites';
import { Card, Disclosure, Field, Input, Select, ReorderActions } from './components';
import { BlocksEditor } from './PagesEditor';
import { newId, moveItem } from './helpers';

export function RegionsEditor({ site, catalogue, onChange }: { site: SiteConfig; catalogue: CatalogueItem[]; onChange: (site: SiteConfig) => void }) {
  const { t } = useTranslation();
  const regions = site.regions ?? [];
  const edit = (index: number, patch: Partial<SiteRegion>) => { onChange({ ...site, regions: regions.map((region, at) => at === index ? { ...region, ...patch } : region) }); };
  return <Card title={t('websites.tabs.regions')} actions={<button type="button" className="websites-button" disabled={regions.length >= 24} onClick={() => { onChange({ ...site, regions: [...regions, { id: newId('region'), title: '', language: null, alignment: 'left', position: 'after_content', blocks: [] }] }); }}>{t('websites.addRegionGroup')}</button>}>
    <p className="websites-muted">{t('websites.regionsHelp')}</p>
    {regions.map((region, index) => <Disclosure key={region.id} title={region.title || t(`websites.regionPositions.${region.position}`)} actions={<ReorderActions index={index} length={regions.length} move={offset => { onChange({ ...site, regions: moveItem(regions, index, offset) }); }} remove={() => { onChange({ ...site, regions: regions.filter((_, at) => at !== index) }); }} />}>
      <div className="websites-grid"><Field label={t('websites.titleLabel')}><Input value={region.title} onChange={event => { edit(index, { title: event.target.value }); }} /></Field>
      <Field label={t('websites.regionPosition')}><Select value={region.position} onChange={event => { edit(index, { position: event.target.value as SiteRegion['position'] }); }}>{['header', 'before_content', 'after_content', 'footer'].map(position => <option key={position} value={position}>{t(`websites.regionPositions.${position}`)}</option>)}</Select></Field>
      <Field label={t('websites.language')}><Select value={region.language ?? ''} onChange={event => { edit(index, { language: event.target.value || null }); }}><option value="">{t('websites.allLanguages')}</option>{(site.languages ?? []).map(language => <option key={language} value={language}>{language.toUpperCase()}</option>)}</Select></Field></div>
      <BlocksEditor site={site} catalogue={catalogue} blocks={region.blocks ?? []} onChange={blocks => { edit(index, { blocks }); }} />
    </Disclosure>)}
  </Card>;
}
