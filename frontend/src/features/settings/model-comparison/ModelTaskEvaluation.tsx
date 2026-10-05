import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import { useActiveVaultId } from '../../../shared/hooks/useActiveVaultId';
import { previewTaskEvaluation, runTaskEvaluation, fetchTaskEvaluationSuite, type TaskEvaluationPlan, type TaskEvaluationRequest, type TaskEvaluationReport, type TaskEvaluationSuite } from '../../../shared/api/ai-activity';
import { formatComparisonCost } from '../modelComparison';
import type { TaskId } from './taskRecommendations';
import { ModelTaskPublicExport } from './ModelTaskPublicExport';
import { ModelTaskSampleResults } from './ModelTaskSampleResults';

type EvaluationProps = {
    readonly agentId: string; readonly provider: string; readonly model: string;
    readonly tasks: readonly TaskId[]; readonly currency: { usd_rate: number; symbol: string };
    readonly active: boolean; readonly onComplete: () => void;
    readonly onBusyChange?: (busy: boolean) => void;
    readonly onConfigure?: () => void; readonly disabled?: boolean;
};

/** Consent and results belong to one bot, vault, route and task selection. */
export function ModelTaskEvaluation(props: EvaluationProps) {
    const vault = useActiveVaultId();
    return <EvaluationEntry key={JSON.stringify([vault, props.agentId, props.provider, props.model, props.tasks])} {...props} />;
}

function EvaluationEntry(props: EvaluationProps) {
    const { t } = useTranslation();
    const [requested, setRequested] = useState(false);
    if (!props.active && props.onConfigure) return <div className="model-task-evaluation">
        <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={props.disabled}
            onClick={() => { setRequested(true); props.onConfigure?.(); }}>{t('model_comparison.tests.configure_to_test')}</button>
        <p className="settings-desc">{t('model_comparison.tests.setup_help')}</p>
    </div>;
    return <EvaluationSession initialOpen={requested} {...props} />;
}

/** Opening reads saved evidence. Only the explicitly authorized button pays. */
function EvaluationSession({ agentId, provider, model, tasks, currency, active, onComplete, onBusyChange, initialOpen }: EvaluationProps & { readonly initialOpen?: boolean }) {
    const { t } = useTranslation();
    const vault = useActiveVaultId();
    const activeVault = useRef(vault);
    useLayoutEffect(() => { activeVault.current = vault; }, [vault]);
    const [open, setOpen] = useState(initialOpen ?? false);
    const isOpen = useRef(open);
    useLayoutEffect(() => { isOpen.current = open; }, [open]);
    const [budget, setBudget] = useState(String(Number((.05 * currency.usd_rate).toFixed(4))));
    const [useShared, setUseShared] = useState(true);
    const [retest, setRetest] = useState(false);
    const [authorized, setAuthorized] = useState(false);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    const mounted = useRef(true);
    const evidenceChanged = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const [plan, setPlan] = useState<TaskEvaluationPlan | null>(null);
    const [suite, setSuite] = useState<TaskEvaluationSuite | null>(null);
    const [checkedAt, setCheckedAt] = useState(0);
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
            if (!open) return;
            const body: TaskEvaluationRequest = { agent_id: agentId, provider, model, tasks: JSON.parse(taskKey) as TaskId[],
                budget_usd: limit, retest, authorize_model_calls: false, suite: 'work', use_shared: useShared };
            const [preview, samples] = await Promise.all([
                active && valid ? previewTaskEvaluation(body, controller.signal) : Promise.resolve(null),
                fetchTaskEvaluationSuite(controller.signal),
            ]);
            if (!controller.signal.aborted) { setPlan(preview); setSuite(samples); setCheckedAt(Date.now()); }
        }).catch(() => { if (!controller.signal.aborted) setError('preview_error'); });
        return () => { controller.abort(); };
    }, [open, active, valid, agentId, provider, model, taskKey, limit, retest, useShared, vault, revision]);
    const money = (usd: number) => formatComparisonCost(usd * currency.usd_rate, currency.symbol);
    const run = async () => {
        if (inFlight.current || !active || !authorized || !plan?.can_run || !valid) return;
        const requestedVault = vault;
        inFlight.current = true; setBusy(true); onBusyChange?.(true); setError(''); setStatus('');
        try {
            const report = await runTaskEvaluation({ agent_id: agentId, provider, model, tasks: [...tasks],
                budget_usd: limit, retest, authorize_model_calls: true, suite: 'work', use_shared: useShared });
            if (!mounted.current || activeVault.current !== requestedVault) return;
            setStatus(report.status === 'completed' ? 'completed' : 'stopped');
            setLastReport(report);
            setAuthorized(false); setRetest(false); setRevision(value => value + 1);
            if (isOpen.current) evidenceChanged.current = true;
            else onComplete();
        } catch { if (mounted.current && activeVault.current === requestedVault) setError('run_error'); }
        finally { inFlight.current = false; if (mounted.current) { setBusy(false); onBusyChange?.(false); } }
    };
    const results = plan?.reused_cases ?? [];
    return <details className="model-task-recommendations__requirements model-task-evaluation" open={open}
        onToggle={event => {
            setOpen(event.currentTarget.open);
            // Keep the tested offer visible until its results have been read.
            if (!event.currentTarget.open && evidenceChanged.current) {
                evidenceChanged.current = false; onComplete();
            }
        }}>
        <summary className="btn-gnosi btn-gnosi-secondary">{t('model_comparison.tests.title')}</summary>
        {open && <>
            <p><strong>{model}</strong> · {provider}</p>
            {active && <p className="settings-desc">{t('model_comparison.tests.run_help')}</p>}
            <p>{t('model_comparison.tests.help')}</p>
            <p>{t('model_comparison.tests.limitations')}</p>
            {suite && <details><summary>{t('model_comparison.tests.work_set')} · {suite.version}</summary>
                {suite.criteria.filter(item => item.tasks.some(task => tasks.includes(task))).map(item => <details key={item.id}>
                    <summary>{item.title || t(`model_comparison.tests.metrics.${item.metric}`)}</summary>
                    <pre>{item.prompt}</pre><p>{t('model_comparison.tests.expected')}</p><pre>{JSON.stringify(item.expected, null, 2)}</pre>
                    {item.requires_review && <p>{t('model_comparison.tests.review_help')}</p>}
                </details>)}
            </details>}
            {!active ? <p role="status">{t('model_comparison.tests.activate_first')}</p> : <>
                <label>{t('model_comparison.tests.budget', { symbol: currency.symbol })}
                    <input className="gnosi-input" value={budget} disabled={busy} type="number" min="0.0001" step="0.01"
                        onChange={event => { setBudget(event.target.value); setAuthorized(false); }} />
                </label>
                <div className="agent-evaluation-lab__authorization"><span>{t('model_comparison.shared.reuse')}</span>
                    <GnosiToggle label={t('model_comparison.shared.reuse')} active={useShared} disabled={busy}
                        onChange={() => { setUseShared(value => !value); setAuthorized(false); }} /></div>
                <div className="agent-evaluation-lab__authorization"><span>{t('model_comparison.tests.retest')}</span>
                    <GnosiToggle label={t('model_comparison.tests.retest')} active={retest} disabled={busy}
                        onChange={() => { setRetest(value => !value); setAuthorized(false); }} /></div>
                {!valid && <p role="alert">{t('model_comparison.tests.invalid_budget')}</p>}
                {plan && <>
                    <p>{t('model_comparison.tests.plan', { reused: results.length, pending: plan.pending_ids.length,
                        cost: plan.maximum_cost_usd === null ? t('model_comparison.unknown_cost') : money(plan.maximum_cost_usd) })}</p>
                    {results.length > 0 && <ul>{results.map(item => <li key={item.id}>
                        {t(`model_comparison.tests.metrics.${item.metric}`)}: {t(item.passed ? 'agent_team.lab_pass' : 'agent_team.lab_fail')}
                        {item.evidence_origin === 'shared' && ` · ${t('model_comparison.shared.case', { count: item.observations, users: item.contributors })}`}
                        {' · '}{item.checked_at.slice(0, 10)} · {(item.latency_ms / 1000).toFixed(2)} s
                        {' · '}{item.cost_usd == null ? t('model_comparison.unknown_cost') : money(item.cost_usd)}
                        {' '}{t(`model_comparison.tests.cost_${item.cost_source}`)}
                        {checkedAt - Date.parse(item.checked_at) > 30 * 86400000 && ` · ${t('model_comparison.tests.old_result')}`}
                    </li>)}</ul>}
                    {suite && <ModelTaskSampleResults results={results} suite={suite} busy={busy} onReviewed={() => {
                        setRevision(value => value + 1); evidenceChanged.current = true;
                    }} />}
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
            <ModelTaskPublicExport key={JSON.stringify([lastReport?.id, results.map(item => item.reused_from)])}
                reportIds={[...new Set([...(lastReport?.public_parameters ? [lastReport.id] : []), ...results.filter(item => item.evidence_origin !== 'shared' && item.reused_from).map(item => item.reused_from)])]} disabled={busy} />
            {error && <p role="alert">{t(`model_comparison.tests.${error}`)}</p>}
        </>}
    </details>;
}
