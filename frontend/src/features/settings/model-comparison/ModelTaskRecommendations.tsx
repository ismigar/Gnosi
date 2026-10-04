import './ModelTaskRecommendations.css';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiModelComparison, AiModelComparisonEntry } from '../../../shared/api/ai';
import { fetchAgentRuns, fetchRoleEvaluations, type AgentExecutionRun, type RoleEvaluationReport } from '../../../shared/api/ai-activity';
import { useActiveVaultId } from '../../../shared/hooks/useActiveVaultId';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import { formatComparisonCost } from '../modelComparison';
import { ModelPriceOffer } from './ModelPriceOffer';
import { recommendTask, TASKS, type Candidate, type TaskId } from './taskRecommendations';
import { operationalEvidence } from './operationalEvidence';

export function ModelTaskRecommendations({ models, feed, provider, profile, revision }: {
    readonly models: readonly AiModelComparisonEntry[];
    readonly feed: AiModelComparison;
    readonly provider: string;
    readonly profile: string;
    readonly revision: number;
}) {
    const { t } = useTranslation();
    const vault = useActiveVaultId();
    const tasks = TASKS.filter(task => profile === 'all' || profile === 'unrated' || task.role === profile);
    const initial = tasks.find(task => task.id === 'book') ?? tasks[0] ?? TASKS[0];
    const [taskId, setTaskId] = useState<TaskId>(initial.id);
    const task = tasks.find(item => item.id === taskId) ?? initial;
    const [input, setInput] = useState(String(task.input));
    const [output, setOutput] = useState(String(task.output));
    const [context, setContext] = useState(String(task.context));
    const [minimum, setMinimum] = useState('60');
    const [budget, setBudget] = useState(task.id === 'book' ? String(.5 * feed.currency.usd_rate) : '');
    const [attempts, setAttempts] = useState('2');
    const [reload, setReload] = useState(0);
    const [evidence, setEvidence] = useState<{ vault: string; reports: RoleEvaluationReport[]; runs: AgentExecutionRun[]; error: boolean }>({ vault: '', reports: [], runs: [], error: false });
    useEffect(() => {
        const controller = new AbortController();
        void Promise.allSettled([fetchRoleEvaluations(controller.signal), fetchAgentRuns(controller.signal)]).then(([reports, runs]) => {
            if (!controller.signal.aborted) setEvidence({ vault,
                reports: reports.status === 'fulfilled' ? reports.value : [], runs: runs.status === 'fulfilled' ? runs.value : [],
                error: reports.status === 'rejected' || runs.status === 'rejected' });
        });
        return () => { controller.abort(); };
    }, [vault, reload, revision]);
    const reports = evidence.vault === vault ? evidence.reports : [];
    const number = (value: string) => Number(value.trim().replace(',', '.'));
    const valid = input.trim() !== '' && output.trim() !== '' && context.trim() !== '' && minimum.trim() !== ''
        && [input, output, context, minimum, attempts, ...(budget.trim() ? [budget] : [])].every(value => Number.isFinite(number(value)) && number(value) >= 0)
        && number(input) > 0 && number(context) > 0 && number(minimum) <= 100
        && Number.isInteger(number(attempts)) && number(attempts) >= 1 && number(attempts) <= 10
        && Number.isFinite(feed.currency.usd_rate) && feed.currency.usd_rate > 0;
    const result = recommendTask(models, feed.models, provider, {
        task, input: number(input), output: number(output), context: number(context),
        minimumQuality: number(minimum), budgetUsd: budget.trim() ? number(budget) / feed.currency.usd_rate : null,
        attempts: number(attempts),
    }, reports);
    const sameOffer = result.balanced && result.cheapest && result.quality
        && [result.cheapest, result.quality].every(candidate => candidate.offer.route.provider === result.balanced?.offer.route.provider
            && candidate.offer.route.model_id === result.balanced.offer.route.model_id
            && candidate.offer.cost === result.balanced.offer.cost
            && candidate.offer.plan === result.balanced.offer.plan);
    const money = (value: number) => formatComparisonCost(value * feed.currency.usd_rate, feed.currency.symbol);
    const field = (key: string, value: string, set: (v: string) => void, max?: number) => <label>
        {t(`model_comparison.recommend.${key}`, { symbol: feed.currency.symbol })}
        <input className="gnosi-input" type="number" min="0" max={max} step={key === 'budget' ? '0.01' : '1'} value={value} onChange={event => { set(event.target.value); }} />
    </label>;
    const history = (candidate: Candidate) => operationalEvidence(evidence.vault === vault ? evidence.runs : [], candidate.offer.route.provider, candidate.offer.route.model_id);
    const metrics = (candidate: Candidate) => Object.entries(task.weights).map(([key, weight]) => {
        const value = candidate.model[key as 'intelligence' | 'coding' | 'agentic'];
        return `${t(`model_comparison.columns.${key}`)}: ${String(value)} (${String(Math.round(weight * 100))}%)`;
    }).join(' · ');
    const render = (candidate: Candidate | undefined, kind: string) => <article className="ai-resource-card model-task-choice" key={kind}>
        <h3>{t(`model_comparison.recommend.${kind}`)}</h3>
        {candidate ? <>
            <strong>{candidate.model.name}</strong>
            <ModelPriceOffer offer={candidate.offer} field="monthly_cost" label={candidate.offer.route.provider_name || candidate.offer.route.provider} currency={feed.currency} active={false} />
            <p>{t('model_comparison.recommend.score', { score: candidate.quality })}</p>
            <p>{t('model_comparison.recommend.benchmark', { metrics: metrics(candidate), date: feed.fetched_at.slice(0, 10) })}</p>
            {candidate.variantCount > 1 && <p>{t('model_comparison.recommend.variants', { count: candidate.variantCount })}</p>}
            <p>{t(`model_comparison.recommend.why_${kind}`)}</p>
            <p>{t(candidate.report ? 'model_comparison.recommend.synthetic' : 'model_comparison.recommend.catalogue', { count: candidate.report?.cases.length ?? 0, date: candidate.report?.created_at.slice(0, 10) ?? '' })}</p>
            {candidate.sampleCostPerSuccess !== null && <p>{t('model_comparison.recommend.sample_cost', { cost: money(candidate.sampleCostPerSuccess) })}</p>}
            {candidate.sampleLatency !== null && <p>{t('model_comparison.recommend.sample_time', { seconds: (candidate.sampleLatency / 1000).toFixed(2) })}</p>}
            <p>{t('model_comparison.recommend.history', history(candidate))}</p>
            <p>{t(`model_comparison.recommend.pending_${task.role}`)}</p>
        </> : <p>{t('model_comparison.recommend.empty')}</p>}
    </article>;
    return <section className="ai-resource-card model-task-recommendations" aria-label={t('model_comparison.recommend.title')}>
        <header className="model-task-recommendations__header"><h3>{t('model_comparison.recommend.title')}</h3><RefreshButton onClick={() => { setReload(value => value + 1); }} /></header>
        <p className="settings-desc">{t('model_comparison.recommend.help')}</p>
        <div className="ai-resource-editor__grid model-task-recommendations__fields">
            <label>{t('model_comparison.recommend.task')}<select className="gnosi-select" value={task.id} onChange={event => {
                const next = tasks.find(item => item.id === event.target.value);
                if (!next) return;
                setTaskId(next.id); setInput(String(next.input)); setOutput(String(next.output)); setContext(String(next.context)); setBudget(next.id === 'book' ? String(.5 * feed.currency.usd_rate) : '');
            }}>{tasks.map(item => <option key={item.id} value={item.id}>{t(`model_comparison.recommend.tasks.${item.id}`)}</option>)}</select></label>
            {field('input', input, setInput)}{field('output', output, setOutput)}{field('context', context, setContext)}
            {field('minimum', minimum, setMinimum, 100)}{field('budget', budget, setBudget)}{field('attempts', attempts, setAttempts, 10)}
        </div>
        <p className="settings-desc">{t('model_comparison.recommend.volume_help')}</p>
        {evidence.vault === vault && evidence.error && <p role="alert">{t('model_comparison.recommend.evidence_error')}</p>}
        {!valid ? <p role="alert">{t('model_comparison.recommend.invalid')}</p> : <>
            {sameOffer && <p className="model-configuration-banner">{t('model_comparison.recommend.same_offer')}</p>}
            <div className="model-task-recommendations__choices">{render(result.balanced, 'balanced')}{render(result.cheapest, 'cheapest')}{render(result.quality, 'quality')}</div>
            <details><summary>{t('model_comparison.recommend.exclusions')}</summary>
                <ul>{Object.entries(result.excluded).filter(([, count]) => count > 0).map(([reason, count]) => <li key={reason}>{t(`model_comparison.recommend.excluded.${reason}`, { count })}</li>)}</ul>
            </details>
        </>}
    </section>;
}
