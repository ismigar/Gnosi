import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTablePublicationSettings, setTablePublicationSettings } from '../../shared/api/sites';
import { currentRequestContext } from '../../shared/api/request-context';
import { useRequestContext } from '../../shared/hooks/useRequestContext';
import { usePlugins } from '../../shared/plugins/usePlugins';
import { apiErrorDetail } from '../../shared/api/errors';
import { Toggle } from './components';
import './Websites.css';

/** Eligibility belongs to the table. Selection and presentation belong to Webs. */
export function TableWebsiteSettings({ tableId }: { tableId?: string }) {
  const { t } = useTranslation();
  const context = useRequestContext();
  const { isEnabled } = usePlugins();
  const enabled = isEnabled('web-publishing');
  const key = JSON.stringify([context, tableId, enabled]);
  const [state, setState] = useState({ key: '', publishable: false, ready: false, saving: false, error: '' });
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    if (enabled && tableId) {
      void getTablePublicationSettings(tableId, context, controller.signal).then(result => {
        if (!controller.signal.aborted) setState({ key, publishable: result.publishable, ready: true, saving: false, error: '' });
      }).catch((failure: unknown) => {
        if (!controller.signal.aborted) setState({ key, publishable: false, ready: false, saving: false, error: apiErrorDetail(failure, t('recordWebsite.failed')) });
      });
    }
    return () => { controller.abort(); };
  }, [context, key, tableId, enabled, t]);
  if (!enabled || !tableId) return null;
  const loaded = state.key === key;
  const change = async (publishable: boolean) => {
    const controller = operation.current;
    if (!loaded || !state.ready || state.saving || !controller) return;
    const scope = JSON.stringify(currentRequestContext());
    const current = () => !controller.signal.aborted && JSON.stringify(currentRequestContext()) === scope;
    if (!current()) return;
    setState(previous => ({ ...previous, saving: true, error: '' }));
    try {
      const result = await setTablePublicationSettings(tableId, publishable, context, controller.signal);
      if (current()) setState({ key, publishable: result.publishable, ready: true, saving: false, error: '' });
    } catch (failure) {
      if (current()) setState(previous => ({ ...previous, saving: false, error: apiErrorDetail(failure, t('recordWebsite.failed')) }));
    }
  };
  return <section className="space-y-3 border-t border-[var(--border-primary)] pt-4" aria-label={t('tableWebsite.title')}>
    <Toggle label={t('tableWebsite.title')} value={loaded && state.publishable} disabled={!loaded || !state.ready || state.saving} onChange={value => { void change(value); }} />
    <p className="websites-muted">{t('tableWebsite.hint')}</p>
    {!loaded && <p role="status">{t('common.loading')}</p>}
    {loaded && state.saving && <p role="status">{t('common.saving')}</p>}
    {loaded && state.error && <p role="alert" className="websites-error">{state.error}</p>}
  </section>;
}
