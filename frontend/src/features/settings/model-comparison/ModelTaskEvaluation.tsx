import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import { useActiveVaultId } from '../../../shared/hooks/useActiveVaultId';
import { previewTaskEvaluation, runTaskEvaluation, type TaskEvaluationPlan, type TaskEvaluationRequest, type TaskEvaluationReport } from '../../../shared/api/ai-activity';
import { formatComparisonCost } from '../modelComparison';
import type { TaskId } from './taskRecommendations';

/** Opening reads saved evidence. Only the explicitly authorized button pays. */
export function ModelTaskEvaluation({ agentId, provider, model, tasks, currency, active, onComplete }: {
    readonly agentId: string; readonly provider: string; readonly model: string;
    readonly tasks: readonly TaskId[]; readonly currency: { usd_rate: number; symbol: string };
    readonly active: boolean; readonly onComplete: () => void;
}) {
    const { t } = useTranslation();
    const vault = useActiveVaultId();
    const activeVault = useRef(vault);
    useLayoutEffect(() => { activeVault.current = vault; }, [vault]);
    const [open, setOpen] = useState(false);
    const [budget, setBudget] = useState(String(Number((.05 * currency.usd_rate).toFixed(4))));
    const [retest, setRetest] = useState(false);
    const [authorized, setAuthorized] = useState(false);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    const [plan, setPlan] = useState<TaskEvaluationPlan | null>(null);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const [lastReport, setLastReport] = useState<TaskEvaluationReport | null>(null);
    const [revision, setRevision] = useState(0);
    const limit = Number(budget.replace(',', '.')) / currency.usd_rate;
    const valid = Number.isFinite(limit) && limit > 0 && limit <= 1;
    const taskKey = JSON.stringify(tasks);
    useEffect(() => {
        const controller = new AbortController();
        void Promise.resolve().then(async () => {
            setPlan(null); setAuthorized(false); setError('');
            if (!open || !active || !valid) return;
            const body: TaskEvaluationRequest = { agent_id: agentId, provider, model, tasks: JSON.parse(taskKey) as TaskId[],
                budget_usd: limit, retest, authorize_model_calls: false };
            const preview = await previewTaskEvaluation(body, controller.signal);
            if (!controller.signal.aborted) setPlan(preview);
        }).catch(() => { if (!controller.signal.aborted) setError('preview_error'); });
        return () => { controller.abort(); };
    }, [open, active, valid, agentId, provider, model, taskKey, limit, retest, vault, revision]);
    const money = (usd: number) => formatComparisonCost(usd * currency.usd_rate, currency.symbol);
    const run = async () => {
        if (inFlight.current || !authorized || !plan?.can_run || !valid) return;
        const requestedVault = vault;
        inFlight.current = true; setBusy(true); setError(''); setStatus('');
        try {
            const report = await runTaskEvaluation({ agent_id: agentId, provider, model, tasks: [...tasks],
                budget_usd: limit, retest, authorize_model_calls: true });
            if (activeVault.current !== requestedVault) return;
            setStatus(report.status === 'completed' ? 'completed' : 'stopped');
            setLastReport(report);
            setAuthorized(false); setRetest(false); setRevision(value => value + 1); onComplete();
        } catch { if (activeVault.current === requestedVault) setError('run_error'); }
        finally { inFlight.current = false; setBusy(false); }
    };
    const results = plan?.reused_cases ?? [];
    return <details className="model-task-recommendations__requirements model-task-evaluation" open={open}
        onToggle={event => { setOpen(event.currentTarget.open); }}>
        <summary>{t('model_comparison.tests.title')}</summary>
        {open && <>
            <p>{t('model_comparison.tests.help')}</p>
            <p>{t('model_comparison.tests.limitations')}</p>
            {!active ? <p role="status">{t('model_comparison.tests.activate_first')}</p> : <>
                <label>{t('model_comparison.tests.budget', { symbol: currency.symbol })}
                    <input className="gnosi-input" value={budget} disabled={busy} type="number" min="0.0001" step="0.01"
                        onChange={event => { setBudget(event.target.value); setAuthorized(false); }} />
                </label>
                <div className="agent-evaluation-lab__authorization"><span>{t('model_comparison.tests.retest')}</span>
                    <GnosiToggle label={t('model_comparison.tests.retest')} active={retest} disabled={busy}
                        onChange={() => { setRetest(value => !value); setAuthorized(false); }} /></div>
                {!valid && <p role="alert">{t('model_comparison.tests.invalid_budget')}</p>}
                {plan && <>
                    <p>{t('model_comparison.tests.plan', { reused: results.length, pending: plan.pending_ids.length,
                        cost: plan.maximum_cost_usd === null ? t('model_comparison.unknown_cost') : money(plan.maximum_cost_usd) })}</p>
                    {results.length > 0 && <ul>{results.map(item => <li key={item.id}>
                        {t(`model_comparison.tests.metrics.${item.metric}`)}: {t(item.passed ? 'agent_team.lab_pass' : 'agent_team.lab_fail')}
                        {' · '}{item.checked_at.slice(0, 10)} · {(item.latency_ms / 1000).toFixed(2)} s
                        {' · '}{item.cost_usd == null ? t('model_comparison.unknown_cost') : money(item.cost_usd)}
                        {' '}{t(`model_comparison.tests.cost_${item.cost_source}`)}
                    </li>)}</ul>}
                    {!plan.can_run && <p role="alert">{t(`model_comparison.tests.errors.${plan.reason}`)}</p>}
                    {plan.can_run && plan.pending_ids.length > 0 && <>
                        <div className="agent-evaluation-lab__authorization"><span>{t('model_comparison.tests.authorize')}</span>
                            <GnosiToggle label={t('model_comparison.tests.authorize')} active={authorized} disabled={busy}
                                onChange={() => { setAuthorized(value => !value); }} /></div>
                        <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={busy || !authorized}
                            onClick={() => { void run(); }}>{t(busy ? 'agent_team.lab_running' : 'model_comparison.tests.run')}</button>
                    </>}
                </>}
            </>}
            {status && <p role="status">{t(`model_comparison.tests.${status}`)}</p>}
            {lastReport?.stop_reason === 'output_limit' && <p role="status">{t('model_comparison.tests.output_limit')}</p>}
            {lastReport && <p>{t('model_comparison.tests.summary', { calls: lastReport.model_calls, reused: lastReport.reused_cases,
                cost: lastReport.cost_usd == null ? t('model_comparison.unknown_cost') : money(lastReport.cost_usd),
                reserved: money(lastReport.reserved_usd) })}</p>}
            {error && <p role="alert">{t(`model_comparison.tests.${error}`)}</p>}
        </>}
    </details>;
}
