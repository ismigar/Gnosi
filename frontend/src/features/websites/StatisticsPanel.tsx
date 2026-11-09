import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Eye, FileText, HardDrive, MousePointerClick, Users } from 'lucide-react';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import type { RequestContext } from '../../shared/api/request-context';
import { siteStatistics, type SiteConfig, type SiteStatistics } from '../../shared/api/sites';
import { Card, Empty, Field, Input, Select } from './components';

export function StatisticsPanel({ site, context, onChange }: { site: SiteConfig; context: RequestContext; onChange: (site: SiteConfig) => void }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<SiteStatistics | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [month, setMonth] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => { if (!controller.signal.aborted) { setLoading(true); setError(false); setData(null); } });
    siteStatistics(site.id, context, controller.signal).then(value => { if (!controller.signal.aborted) setData(value); }).catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, [site.id, site.revision, context, revision]);
  const number = (value: number) => new Intl.NumberFormat(i18n.language).format(value);
  const volume = (value: number) => `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value / 1024 ** 2)} MB`;
  const label = (value: string) => new Intl.DateTimeFormat(i18n.language, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`));
  const selected = data?.months.find(value => value.month === month) ?? data?.months.at(-1);
  const max = Math.max(1, ...(data?.months.map(value => value.visits) ?? []));
  let defaultSource = '/webalizer/';
  try { defaultSource = new URL('/webalizer/', site.origin).href; } catch { /* An unfinished origin remains editable. */ }
  const metrics = selected ? [
    ['visits', selected.visits, Eye], ['pages', selected.pages, FileText], ['hits', selected.hits, MousePointerClick], ['clients', selected.clients, Users], ['transfer', selected.transfer_bytes, HardDrive],
  ] as const : [];
  return <div className="websites-statistics">
    <Card title={t('websites.tabs.statistics')} collapsible={false} actions={<RefreshButton loading={loading} onClick={() => { setRevision(value => value + 1); }} />}>
      <Field label={t('websites.statistics.source')} help={t('websites.statistics.sourceHelp')}><Input type="url" value={site.statistics_url ?? ''} placeholder={defaultSource} onChange={event => { onChange({ ...site, statistics_url: event.target.value }); }} /></Field>
      {loading && <p role="status">{t('websites.statistics.loading')}</p>}
      {error && <p role="alert" className="websites-error">{t('websites.statistics.error')}</p>}
      {!loading && !error && !selected && <Empty>{t('websites.statistics.empty')}</Empty>}
      {data && selected && <>
        <div className="websites-row-title"><div><p className="websites-statistics-eyebrow">{site.name}</p><h3>{t('websites.statistics.traffic')}</h3></div><Field label={t('websites.statistics.month')}><Select value={selected.month} onChange={event => { setMonth(event.target.value); }}>{[...data.months].reverse().map(value => <option key={value.month} value={value.month}>{label(value.month)}</option>)}</Select></Field></div>
        <p className="websites-statistics-meta">{t('websites.statistics.generated')}: {data.generated_at || t('websites.statistics.unknown')} · {t('websites.statistics.fetched')}: {new Date(data.fetched_at).toLocaleString(i18n.language)}</p>
        <p className="websites-statistics-meta">{t('websites.statistics.caveat')}</p>
        <div className="websites-statistics-metrics">{metrics.map(([key, value, Icon]) => <section className="websites-row" key={key}><Icon size={19} aria-hidden="true" /><span>{t(`websites.statistics.${key}`)}</span><strong className="websites-stat">{key === 'transfer' ? volume(value) : number(value)}</strong></section>)}</div>
        <section className="websites-row"><h3><BarChart3 size={18} aria-hidden="true" /> {t('websites.statistics.evolution')}</h3><div className="websites-statistics-chart" role="img" aria-label={t('websites.statistics.evolution')}>{data.months.map(value => <div key={value.month} className="websites-statistics-column"><span>{number(value.visits)}</span><div className="websites-statistics-track"><div className="websites-statistics-bar" style={{ height: `${String(value.visits / max * 100)}%` }} /></div><span>{label(value.month)}</span></div>)}</div></section>
        <div className="websites-table-wrap"><table className="websites-table"><caption>{t('websites.statistics.history')}</caption><thead><tr>{['month', 'visits', 'pages', 'hits', 'clients', 'transfer'].map(key => <th scope="col" key={key}>{t(`websites.statistics.${key}`)}</th>)}</tr></thead><tbody>{[...data.months].reverse().map(value => <tr key={value.month}><th scope="row">{label(value.month)}</th><td>{number(value.visits)}</td><td>{number(value.pages)}</td><td>{number(value.hits)}</td><td>{number(value.clients)}</td><td>{volume(value.transfer_bytes)}</td></tr>)}</tbody></table></div>
        <a href={data.source_url} target="_blank" rel="noreferrer">{t('websites.statistics.openSource')}</a>
      </>}
    </Card>
  </div>;
}
