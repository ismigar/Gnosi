import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deleteSkillAuditSuite,
  fetchSkillAuditSuites,
  runSkillAuditSuite,
  type SkillAuditSuite,
} from '../../../shared/api/skill-audits';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';

export function SkillAuditsPanel() {
  const { t } = useTranslation();
  const [suites, setSuites] = useState<SkillAuditSuite[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const rows = await fetchSkillAuditSuites(signal);
      if (!signal?.aborted) {
        setSuites(rows);
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

  const handleRun = async (suiteId: string) => {
    setBusyId(suiteId);
    try {
      const result = await runSkillAuditSuite(suiteId);
      setSuites(previous => previous.map(item => (item.suite_id === suiteId ? { ...item, last_status: result.status, last_run_at: result.created_at } : item)));
      setError('');
    } catch (failure: unknown) {
      setError(String(failure));
    } finally {
      setBusyId('');
    }
  };

  const handleDelete = async (suiteId: string) => {
    setBusyId(suiteId);
    try {
      await deleteSkillAuditSuite(suiteId);
      setSuites(previous => previous.filter(item => item.suite_id !== suiteId));
      setError('');
    } catch (failure: unknown) {
      setError(String(failure));
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="ai-resource-list" aria-label={t('skill_audits.title')}>
      <div className="ai-resource-card__header">
        <div>
          <h3>{t('skill_audits.title')}</h3>
          <p>{t('skill_audits.subtitle')}</p>
        </div>
        <RefreshButton onClick={() => { void load(); }} loading={loading} label={t('common.refresh')} />
      </div>
      {error && <p role="alert">{error}</p>}
      {!loading && suites.length === 0 && <p>{t('skill_audits.empty')}</p>}
      {suites.map(suite => (
        <article className="ai-resource-card" key={suite.suite_id}>
          <div className="ai-resource-card__header">
            <strong>{suite.name}</strong>
            {suite.last_status && <span className="ai-resource-badge">{t(`skill_audits.status.${suite.last_status}`)}</span>}
          </div>
          <p>{suite.skill_id} · {t('skill_audits.every_days', { days: suite.interval_days })} · {t('skill_audits.cases_count', { count: suite.cases.length })}</p>
          <div className="ai-resource-card__actions">
            <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={busyId === suite.suite_id} onClick={() => { void handleRun(suite.suite_id); }}>
              {t('skill_audits.run_now')}
            </button>
            <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={busyId === suite.suite_id} onClick={() => { void handleDelete(suite.suite_id); }}>
              {t('common.delete')}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
