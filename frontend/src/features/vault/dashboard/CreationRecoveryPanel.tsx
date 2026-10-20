import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { acknowledgePageCreation, fetchPageCreationStatus, pendingPageCreations, resumePageCreation,
  type CreationStatus, type PendingCreation } from '../../../shared/api/page-creation-recovery';
import { currentRequestContext } from '../../../shared/api/request-context';
import { subscribeAppEvent, subscribeAppSignal } from '../../../shared/platform/app-events';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import { GnosiApiError } from '../../../shared/api/errors';

type RecoveryResult = CreationStatus | { readonly status: 'not_found'; readonly page_id: ''; readonly result: null };

export function CreationRecoveryPanel({ onOpen }: { readonly onOpen: (id: string) => void | Promise<void> }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<PendingCreation[]>(() => {
    try { return pendingPageCreations(); } catch { return []; }
  });
  const [results, setResults] = useState<Record<string, RecoveryResult>>({});
  const [loading, setLoading] = useState(false);
  const [resuming, setResuming] = useState<Record<string, boolean>>({});
  const inFlight = useRef(new Set<string>());
  const [error, setError] = useState(() => {
    try { pendingPageCreations(); return false; } catch { return true; }
  });
  const reload = useCallback(() => {
    try { setEntries(pendingPageCreations()); setError(false); }
    catch { setError(true); }
  }, []);
  useEffect(() => {
    const reset = () => { setResults({}); setResuming({}); reload(); };
    const unsubscribe = subscribeAppSignal('gnosi:page-creations-changed', reload);
    const vault = subscribeAppEvent('gnosi:vault-changed', reset);
    const storage = subscribeWindowEvent('storage', reset);
    return () => { unsubscribe(); vault(); storage(); };
  }, [reload]);
  async function refresh() {
    if (inFlight.current.size > 0) return;
    const context = currentRequestContext();
    setLoading(true); setError(false);
    try {
      const statuses = await Promise.allSettled(entries.map(async entry => {
        try { return [entry.key, await fetchPageCreationStatus(entry.key, context)] as const; }
        catch (failure) {
          if (failure instanceof GnosiApiError && failure.status === 404) {
            return [entry.key, { status: 'not_found', page_id: '', result: null } as const] as const;
          }
          throw failure;
        }
      }));
      if (JSON.stringify(context) === JSON.stringify(currentRequestContext())) {
        const next: Record<string, RecoveryResult> = {};
        for (const item of statuses) {
          if (item.status === 'fulfilled') next[item.value[0]] = item.value[1];
        }
        setResults(next);
        setError(statuses.some(item => item.status === 'rejected'));
      }
    } catch { setError(true); }
    finally { setLoading(false); }
  }
  async function open(entry: PendingCreation, status: CreationStatus) {
    const context = currentRequestContext();
    try {
      await onOpen(status.page_id);
      if (status.status === 'completed') await acknowledgePageCreation(entry.key, context);
    } catch { setError(true); }
  }
  async function resume(entry: PendingCreation) {
    const context = currentRequestContext();
    const operation = `${JSON.stringify(context)}:${entry.key}`;
    if (inFlight.current.has(operation)) return;
    inFlight.current.add(operation);
    setResuming(previous => ({ ...previous, [entry.key]: true }));
    setError(false);
    try {
      const result = await resumePageCreation(entry.key, context);
      if (JSON.stringify(context) === JSON.stringify(currentRequestContext())) {
        setResults(previous => ({ ...previous, [entry.key]: {
          status: 'completed', page_id: result.id, result, page_available: true, can_resume: false, steps: [],
        } }));
      }
    } catch {
      if (JSON.stringify(context) === JSON.stringify(currentRequestContext())) setError(true);
    } finally {
      inFlight.current.delete(operation);
      if (JSON.stringify(context) === JSON.stringify(currentRequestContext())) {
        setResuming(previous => ({ ...previous, [entry.key]: false }));
      }
    }
  }
  if (entries.length === 0 && !error) return null;
  return <section className="p-3 border-b shrink-0" aria-label={t('creation_recovery.title')}>
    <div className="flex items-center justify-between gap-2">
      <strong>{t('creation_recovery.title')}</strong>
      <RefreshButton label={t('creation_recovery.check')} loading={loading || Object.values(resuming).some(Boolean)} onClick={() => { void refresh(); }} />
    </div>
    {error && <p role="alert">{t('creation_recovery.check_failed')}</p>}
    <ul className="space-y-2">
      {entries.map(entry => {
        const status = results[entry.key];
        const savedUnknown = status?.status === 'unknown' && status.page_available;
        return <li key={entry.key} className="flex items-center justify-between gap-2">
          <span>{entry.title} — {t(`creation_recovery.${savedUnknown ? 'unknown_saved' : status?.status ?? 'unconfirmed'}`)}</span>
          {status?.status === 'unknown' && status.can_resume &&
            <button type="button" className="btn btn-gnosi-primary px-3 py-1" disabled={loading || resuming[entry.key]}
              onClick={() => { void resume(entry); }}>
              {t(resuming[entry.key] ? 'creation_recovery.resuming' : 'creation_recovery.resume')}
            </button>}
          {status && ((status.status === 'completed' && status.result) || savedUnknown) &&
            <button type="button" className="btn btn-gnosi-primary px-3 py-1" disabled={resuming[entry.key]} onClick={() => { void open(entry, status); }}>
              {t(savedUnknown ? 'creation_recovery.open_saved' : 'creation_recovery.open')}
            </button>}
        </li>;
      })}
    </ul>
  </section>;
}
