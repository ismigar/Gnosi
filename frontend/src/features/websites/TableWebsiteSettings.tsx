import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listSites, saveTableWebsiteBinding, type SiteConfig, type SiteSource } from '../../shared/api/sites';
import { currentRequestContext } from '../../shared/api/request-context';
import { useRequestContext } from '../../shared/hooks/useRequestContext';
import { usePlugins } from '../../shared/plugins/usePlugins';
import { apiErrorDetail } from '../../shared/api/errors';
import { Field, Input, Select, Toggle } from './components';
import { newId } from './helpers';
import './Websites.css';

interface TableField { id: string; name: string; type: string; }

/** Website source configuration is the single persisted publication switch. */
export function TableWebsiteSettings({ tableId, tableName, fields }: { tableId?: string; tableName: string; fields: readonly TableField[] }) {
  const { t } = useTranslation();
  const sectionsId = useId();
  const context = useRequestContext();
  const { isEnabled } = usePlugins();
  const enabled = isEnabled('web-publishing');
  const key = JSON.stringify([context, tableId, enabled]);
  const [loaded, setLoaded] = useState<{ key: string; sites: SiteConfig[] }>({ key: '', sites: [] });
  const [selection, setSelection] = useState<{ key: string; siteId: string; source: SiteSource } | null>(null);
  const [status, setStatus] = useState({ key: '', error: '', saving: false, saved: false });
  const { error, saving, saved } = status.key === key ? status : { error: '', saving: false, saved: false };
  const update = (patch: Partial<Omit<typeof status, 'key'>>) => { setStatus(previous => ({ ...(previous.key === key ? previous : { error: '', saving: false, saved: false }), key, ...patch })); };
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    if (enabled && tableId) {
      void listSites(context, controller.signal).then(sites => {
        if (!controller.signal.aborted) setLoaded({ key, sites });
      }).catch((failure: unknown) => {
        if (!controller.signal.aborted) setStatus({ key, error: apiErrorDetail(failure, t('recordWebsite.failed')), saving: false, saved: false });
      });
    }
    return () => { controller.abort(); };
  }, [context, key, tableId, enabled, t]);
  if (!enabled || !tableId) return null;
  const sites = loaded.key === key ? loaded.sites : [];
  const bound = sites.find(site => site.sources?.some(source => source.kind === 'table' && source.source_id === tableId));
  const site = sites.find(item => item.id === (selection?.key === key ? selection.siteId : bound?.id));
  const bindings = site?.sources?.filter(item => item.kind === 'table' && item.source_id === tableId) ?? [];
  const activeChoice = selection?.key === key && selection.siteId === site?.id ? selection : null;
  const existing = activeChoice ? bindings.find(item => item.id === activeChoice.source.id) : bindings[0];
  const source = activeChoice?.source ?? existing;
  const choose = (siteId: string) => {
    const target = sites.find(item => item.id === siteId);
    if (!target) { setSelection(null); return; }
    setSelection({ key, siteId, source: target.sources?.find(item => item.kind === 'table' && item.source_id === tableId)
      ?? { id: newId('table'), kind: 'table', source_id: tableId, enabled: false, title: tableName, field_ids: [], attachment_field_ids: [], include_body: false, path_prefix: '/content', selection_mode: 'selected', page_ids: [], withdrawn_ids: [], filters: [], sort_descending: false, presentation: 'cards' } });
    update({ saved: false, error: '' });
  };
  const change = (patch: Partial<SiteSource>) => {
    if (site && source) { setSelection({ key, siteId: site.id, source: { ...source, ...patch } }); update({ saved: false }); }
  };
  const save = async () => {
    if (!site || !source || saving || !operation.current || operation.current.signal.aborted) return;
    const controller = operation.current;
    const scope = JSON.stringify(currentRequestContext());
    update({ saving: true, error: '' });
    try {
      const result = await saveTableWebsiteBinding(site.id, { revision: site.revision, table_id: tableId, source_id: existing?.id, section: source.path_prefix, enabled: source.enabled, include_body: source.include_body, field_ids: source.field_ids, attachment_field_ids: source.attachment_field_ids }, context, controller.signal);
      if (!controller.signal.aborted && JSON.stringify(currentRequestContext()) === scope) {
        setLoaded({ key, sites: sites.map(item => item.id === result.id ? result : item) });
        const savedBinding = result.sources?.find(item => item.kind === 'table' && item.source_id === tableId && item.path_prefix === source.path_prefix);
        setSelection(savedBinding ? { key, siteId: result.id, source: savedBinding } : null); update({ saved: true });
      }
    } catch (failure) {
      if (!controller.signal.aborted) setStatus({ key, error: apiErrorDetail(failure, t('recordWebsite.failed')), saving: false, saved: false });
    } finally { if (!controller.signal.aborted) update({ saving: false }); }
  };
  return <section className="websites-panel border-t border-[var(--border-primary)] pt-4" aria-label={t('tableWebsite.title')}>
    <h4 className="font-semibold">{t('tableWebsite.title')}</h4>
    <p className="websites-muted">{t('tableWebsite.hint')}</p>
    {loaded.key !== key && !error && <p role="status">{t('common.loading')}</p>}
    {error && <p role="alert" className="websites-error">{error}</p>}
    {loaded.key === key && !sites.length && <p>{t('tableWebsite.noSites')}</p>}
    <Field label={t('tableWebsite.website')}><Select disabled={saving} value={site?.id ?? ''} onChange={event => { choose(event.target.value); }}><option value="">{t('tableWebsite.choose')}</option>{sites.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
    {site && bindings.length > 0 && <Field label={t('tableWebsite.binding')}><Select disabled={saving} value={existing?.id ?? ''} onChange={event => {
      const selected = bindings.find(item => item.id === event.target.value);
      if (selected) setSelection({ key, siteId: site.id, source: selected });
      else setSelection({ key, siteId: site.id, source: { id: newId('table'), kind: 'table', source_id: tableId, enabled: false, title: tableName, field_ids: [], attachment_field_ids: [], include_body: false, path_prefix: '/content', selection_mode: 'selected', page_ids: [], withdrawn_ids: [], filters: [], sort_descending: false, presentation: 'cards' } });
      update({ saved: false });
    }}><option value="">{t('tableWebsite.newBinding')}</option>{bindings.map(item => <option key={item.id} value={item.id}>{item.path_prefix}</option>)}</Select></Field>}
    {site && source && <fieldset disabled={saving} className="space-y-3">
      <Toggle label={t('tableWebsite.title')} value={source.enabled} onChange={value => { change({ enabled: value }); }} />
      <Field label={t('tableWebsite.section')}><Input list={sectionsId} value={source.path_prefix} onChange={event => { change({ path_prefix: event.target.value }); }} /></Field>
      <datalist id={sectionsId}>{[...new Map((site.sources ?? []).map(item => [item.path_prefix, item.title])).entries()].map(([path, title]) => <option key={path} value={path}>{title}</option>)}</datalist>
      <Toggle label={t('websites.includeBody')} value={source.include_body} onChange={include_body => { change({ include_body }); }} />
      <details><summary>{t('websites.publicFields')}</summary>{fields.filter(field => !/file|attachment|image|media/u.test(field.type)).map(field => <Toggle key={field.id} label={field.name} value={(source.field_ids ?? []).includes(field.id)} onChange={value => { change({ field_ids: value ? [...(source.field_ids ?? []), field.id] : (source.field_ids ?? []).filter(id => id !== field.id) }); }} />)}</details>
      <details><summary>{t('websites.publicAttachments')}</summary>{fields.filter(field => /file|attachment|image|media/u.test(field.type)).map(field => <Toggle key={field.id} label={field.name} value={(source.attachment_field_ids ?? []).includes(field.id)} onChange={value => { change({ attachment_field_ids: value ? [...(source.attachment_field_ids ?? []), field.id] : (source.attachment_field_ids ?? []).filter(id => id !== field.id) }); }} />)}</details>
      <button type="button" className="websites-button" onClick={() => { void save(); }}>{saving ? t('common.saving') : t('tableWebsite.save')}</button>
    </fieldset>}
    {saved && <p role="status">{t('tableWebsite.saved')}</p>}
  </section>;
}
