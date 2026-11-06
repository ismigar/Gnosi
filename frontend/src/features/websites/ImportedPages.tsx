import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { editableSitePages, type SitePage, type SiteConfig } from '../../shared/api/sites';
import { useWebsiteAssets } from './websiteAssetContext';
import { Disclosure, Field, Select } from './components';

export function ImportedPages({ site, onChange }: { site: SiteConfig; onChange: (value: SiteConfig) => void }) {
  const { t } = useTranslation(); const scope = useWebsiteAssets();
  const context = scope?.context;
  const [pages, setPages] = useState<SitePage[]>([]); const [selected, setSelected] = useState(''); const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!context || !site.legacy_pilot) return;
    const controller = new AbortController();
    void editableSitePages(site.id, context, controller.signal).then(setPages).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); };
  }, [site.id, site.legacy_pilot, context]);
  if (!site.legacy_pilot || !scope) return null;
  const available = pages.filter(page => !(site.pages ?? []).some(existing => existing.path === page.path));
  return <Disclosure title={t('websites.visual.importedPage')}><p>{t('websites.visual.importHint')}</p>{failed && <p role="alert">{t('websites.operationFailed')}</p>}
    <div className="websites-actions"><Field label={t('websites.visual.importedPage')}><Select value={selected} onChange={event => { setSelected(event.target.value); }}><option value="">{t('websites.choose')}</option>{available.map(page => <option key={page.id} value={page.id}>{page.title} · {page.language.toUpperCase()}</option>)}</Select></Field>
      <button type="button" className="websites-button" disabled={!available.some(page => page.id === selected)} onClick={() => { const page = available.find(item => item.id === selected); if (page) { onChange({ ...site, pages: [...(site.pages ?? []), page] }); setSelected(''); } }}>{t('websites.visual.editImported')}</button></div>
  </Disclosure>;
}
