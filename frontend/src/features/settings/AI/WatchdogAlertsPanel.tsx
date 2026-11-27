import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  dismissWatchdogAlert,
  fetchWatchdogAlerts,
  runWatchdogSweep,
  type WatchdogAlert,
} from '../../../shared/api/watchdog';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';

export function WatchdogAlertsPanel() {
  const { t } = useTranslation();
  const [alerts, setAlerts] = useState<WatchdogAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const rows = await fetchWatchdogAlerts(signal);
      if (!signal?.aborted) {
        setAlerts(rows);
        setError('');
      }
    } catch (failure: unknown) {
      if (!signal?.aborted) setError(String(failure));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return load(controller.signal);
      return undefined;
    });
    return () => { controller.abort(); };
  }, [load]);

  const handleSweep = async () => {
    setSweeping(true);
    try {
      const result = await runWatchdogSweep();
      setAlerts(result.open_alerts);
      setError('');
    } catch (failure: unknown) {
      setError(String(failure));
    } finally {
      setSweeping(false);
    }
  };

  const handleDismiss = async (alertId: string) => {
    setBusyId(alertId);
    try {
      await dismissWatchdogAlert(alertId);
      setAlerts(previous => previous.filter(item => item.alert_id !== alertId));
      setError('');
    } catch (failure: unknown) {
      setError(String(failure));
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="ai-resource-list" aria-label={t('watchdog.title')}>
      <div className="ai-resource-card__header">
        <div>
          <h3>{t('watchdog.title')}</h3>
          <p>{t('watchdog.subtitle')}</p>
        </div>
        <div className="ai-resource-card__actions">
          <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={sweeping} onClick={() => { void handleSweep(); }}>
            {t('watchdog.sweep_now')}
          </button>
          <RefreshButton onClick={() => { void load(); }} loading={loading} label={t('common.refresh')} />
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {!loading && alerts.length === 0 && <p>{t('watchdog.empty')}</p>}
      {alerts.map(alert => (
        <article className="ai-resource-card" key={alert.alert_id}>
          <div className="ai-resource-card__header">
            <strong>{alert.operation || alert.run_id}</strong>
            <span className="ai-resource-badge">{t(`watchdog.kind.${alert.kind}`)}</span>
          </div>
          <p>{alert.summary}</p>
          <div className="ai-resource-card__actions">
            <span>{t(`watchdog.action.${alert.suggested_action}`)}</span>
            <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={busyId === alert.alert_id} onClick={() => { void handleDismiss(alert.alert_id); }}>
              {t('watchdog.dismiss')}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
