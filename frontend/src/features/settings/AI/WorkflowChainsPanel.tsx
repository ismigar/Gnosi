import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  cancelWorkflowChain,
  fetchWorkflowChains,
  runWorkflowChain,
  type WorkflowChainRun,
} from '../../../shared/api/workflow-chains';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';

export function WorkflowChainsPanel() {
  const { t } = useTranslation();
  const [chains, setChains] = useState<WorkflowChainRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const rows = await fetchWorkflowChains(signal);
      if (!signal?.aborted) {
        setChains(rows);
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

  const act = async (chainId: string, action: 'run' | 'cancel') => {
    setBusyId(chainId);
    try {
      const updated = action === 'run' ? await runWorkflowChain(chainId) : await cancelWorkflowChain(chainId);
      setChains(previous => previous.map(item => (item.chain_id === chainId ? updated : item)));
      setError('');
    } catch (failure: unknown) {
      setError(String(failure));
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="ai-resource-list" aria-label={t('workflow_chains.title')}>
      <div className="ai-resource-card__header">
        <div>
          <h3>{t('workflow_chains.title')}</h3>
          <p>{t('workflow_chains.subtitle')}</p>
        </div>
        <RefreshButton onClick={() => { void load(); }} loading={loading} label={t('common.refresh')} />
      </div>
      {error && <p role="alert">{error}</p>}
      {!loading && chains.length === 0 && <p>{t('workflow_chains.empty')}</p>}
      {chains.map(chain => (
        <article className="ai-resource-card" key={chain.chain_id}>
          <div className="ai-resource-card__header">
            <strong>{chain.name}</strong>
            <span className="ai-resource-badge">{t(`workflow_chains.status.${chain.status}`)}</span>
          </div>
          <ol className="ai-resource-list">
            {chain.steps.map(step => (
              <li key={step.step_id}>
                <span>{step.name}</span> — <span>{t(`workflow_chains.status.${step.status}`)}</span>
                {step.error && <p role="alert">{step.error}</p>}
              </li>
            ))}
          </ol>
          <div className="ai-resource-card__actions">
            {['pending', 'failed', 'awaiting_confirmation'].includes(chain.status) && (
              <button
                type="button"
                className="btn-gnosi btn-gnosi-primary"
                disabled={busyId === chain.chain_id}
                onClick={() => { void act(chain.chain_id, 'run'); }}
              >
                {t(chain.status === 'pending' ? 'workflow_chains.run' : 'workflow_chains.resume')}
              </button>
            )}
            {['pending', 'running', 'awaiting_confirmation'].includes(chain.status) && (
              <button
                type="button"
                className="btn-gnosi btn-gnosi-secondary"
                disabled={busyId === chain.chain_id}
                onClick={() => { void act(chain.chain_id, 'cancel'); }}
              >
                {t('workflow_chains.cancel')}
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
