import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchAgentRuns, changeAgentRun, type AgentExecutionRun } from '../../../shared/api/ai-activity';
import { useActiveVaultId } from '../../../shared/hooks/useActiveVaultId';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import { operationStatusLabel } from './aiResourceI18n';
import { AgentTraceDetails } from './AgentTraceDetails';
import { AgentTraceRetention } from './AgentTraceRetention';

export function AgentExecutionHistory({ canEdit }: { readonly canEdit: boolean }) {
    const { t, i18n } = useTranslation();
    const vaultId = useActiveVaultId();
    const [runs, setRuns] = useState<AgentExecutionRun[]>([]);
    const [error, setError] = useState('');
    const [version, setVersion] = useState(0);
    const [pending, setPending] = useState('');
    useEffect(() => {
        const controller = new AbortController();
        void fetchAgentRuns(controller.signal).then(result => {
            if (!controller.signal.aborted) { setRuns(result); setError(''); }
        }).catch((failure: unknown) => { if (!controller.signal.aborted) setError(String(failure)); });
        return () => { controller.abort(); };
    }, [vaultId, version]);
    const change = async (id: string, action: 'cancel' | 'resume') => {
        setPending(id);
        try { await changeAgentRun(id, action); setVersion(value => value + 1); }
        catch (failure) { setError(String(failure)); }
        finally { setPending(''); }
    };
    const ids = new Set(runs.map(run => run.run_id));
    const render = (run: AgentExecutionRun) => <article className="ai-resource-card" key={run.run_id}>
        <div className="ai-resource-card__main"><span className="ai-resource-card__copy">
            <strong>{t(`agent_execution.skills.${run.operation.split('.')[0] ?? run.operation}`, { defaultValue: run.operation })}</strong>
            <span>{t(`agent_execution.origins.${run.origin}`, { defaultValue: run.origin })} · {operationStatusLabel(t, run.status)}</span>
            <span className="ai-resource-card__meta">{run.agent_id} · {run.skill_id}</span>
            <span className="ai-resource-card__meta">{new Date(run.created_at * 1000).toLocaleString(i18n.resolvedLanguage)} · {run.provider}/{run.model}</span>
            <span>{run.usage_available ? t('agent_execution.consumption', { input: run.input_tokens, output: run.output_tokens, calls: run.model_calls }) : t('agent_execution.usage_unavailable')}</span>
        </span></div>
        {run.error && <p role="alert">{run.error}</p>}
        <AgentTraceDetails key={run.run_id} runId={run.run_id} state={run.trace_state} canDelete={canEdit && !['queued', 'running', 'resuming'].includes(run.status)} />
        {run.result && <details className="ai-resource-details"><summary>{t('activity.result_details')}</summary><pre className="whitespace-pre-wrap">{run.result}</pre></details>}
        {canEdit && ['queued', 'running', 'resuming'].includes(run.status) && <button className="btn-gnosi-secondary" disabled={Boolean(pending)} onClick={() => { void change(run.run_id, 'cancel'); }}>{t('common.cancel')}</button>}
        {canEdit && run.resumable && ['failed', 'cancelled', 'interrupted'].includes(run.status) && <button className="btn-gnosi-secondary" disabled={Boolean(pending)} onClick={() => { void change(run.run_id, 'resume'); }}>{t('agent_execution.resume')}</button>}
    </article>;
    const renderTree = (run: AgentExecutionRun, depth = 0): ReactNode => <div key={run.run_id}>
        {render(run)}
        {depth < 8 && runs.filter(child => child.parent_run_id === run.run_id).map(child => renderTree(child, depth + 1))}
    </div>;
    return <section className="ai-resources-panel">
        <div className="flex justify-between"><strong>{t('agent_execution.history')}</strong><RefreshButton onClick={() => { setVersion(value => value + 1); }} /></div>
        {error && <p role="alert">{error}</p>}
        {canEdit && <AgentTraceRetention />}
        <div className="ai-resource-list">{runs.filter(run => !run.parent_run_id || !ids.has(run.parent_run_id)).map(run => renderTree(run))}</div>
    </section>;
}
