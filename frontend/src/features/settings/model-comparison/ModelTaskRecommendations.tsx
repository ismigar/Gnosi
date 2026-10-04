import './ModelTaskRecommendations.css';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiModelComparison, AiModelComparisonEntry, AiModelRegistryEntry } from '../../../shared/api/ai';
import { fetchAgentRuns, fetchRoleEvaluations, type AgentExecutionRun, type RoleEvaluationReport } from '../../../shared/api/ai-activity';
import { useActiveVaultId } from '../../../shared/hooks/useActiveVaultId';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import { formatComparisonCost } from '../modelComparison';
import { ModelPriceOffer } from './ModelPriceOffer';
import { recommendTask, TASKS, type Candidate, type TaskId } from './taskRecommendations';
import { operationalEvidence } from './operationalEvidence';

export interface TaskRecommendationDraft {
    taskId: TaskId; input: string; output: string; context: string; minimum: string; budget: string; attempts: string;
}

export function ModelTaskRecommendations({ models, feed, provider, profile, revision, initialTask, registry = [], onConfigure, onAssign, botName, disabled = false, initialDraft, onDraftChange }: {
    readonly models: readonly AiModelComparisonEntry[];
    readonly feed: AiModelComparison;
    readonly provider: string;
    readonly profile: string;
    readonly revision: number;
    readonly initialTask?: TaskId;
    readonly registry?: readonly AiModelRegistryEntry[];
    readonly onConfigure?: (candidate: Candidate) => void;
    readonly onAssign?: (candidate: Candidate) => void;
    readonly botName?: string;
    readonly disabled?: boolean;
    readonly initialDraft?: TaskRecommendationDraft;
    readonly onDraftChange?: (draft: TaskRecommendationDraft) => void;
}) {
    const { t } = useTranslation();
    const vault = useActiveVaultId();
    const tasks = TASKS.filter(task => profile === 'all' || profile === 'unrated' || task.role === profile);
    const initial = tasks.find(task => task.id === (initialTask ?? 'book')) ?? tasks[0] ?? TASKS[0];
    const [taskId, setTaskId] = useState<TaskId>(initialDraft?.taskId ?? initial.id);
    const task = tasks.find(item => item.id === taskId) ?? initial;
    const [input, setInput] = useState(initialDraft?.input ?? (String(task.input)));
    const [output, setOutput] = useState(initialDraft?.output ?? (String(task.output)));
    const [context, setContext] = useState(initialDraft?.context ?? (String(task.context)));
    const [minimum, setMinimum] = useState(initialDraft?.minimum ?? ('60'));
    const [budget, setBudget] = useState(initialDraft?.budget ?? (task.id === 'book' ? String(Number((.5 * feed.currency.usd_rate).toFixed(2))) : ''));
    const [attempts, setAttempts] = useState(initialDraft?.attempts ?? ('2'));
    useEffect(() => { onDraftChange?.({ taskId, input, output, context, minimum, budget, attempts }); },
        [taskId, input, output, context, minimum, budget, attempts, onDraftChange]);
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
    const choices: { candidate: Candidate | undefined; kinds: string[] }[] = [];
    for (const [kind, candidate] of [['balanced', result.balanced], ['cheapest', result.cheapest], ['quality', result.quality]] as const) {
        const match = candidate && choices.find(choice => choice.candidate?.offer.route.provider === candidate.offer.route.provider
            && choice.candidate.offer.route.model_id === candidate.offer.route.model_id
            && choice.candidate.offer.cost === candidate.offer.cost && choice.candidate.offer.plan === candidate.offer.plan);
        if (match) match.kinds.push(kind);
        else choices.push({ candidate, kinds: [kind] });
    }
    const sameOffer = choices.length === 1 && Boolean(choices[0]?.candidate);
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
    const render = (candidate: Candidate | undefined, kinds: string[]) => <article className="ai-resource-card model-task-choice" key={kinds[0]}>
        <h3>{kinds.map(kind => t(`model_comparison.recommend.${kind}`)).join(' · ')}</h3>
        {candidate ? <>
            <strong>{candidate.model.name}</strong>
            <ModelPriceOffer offer={candidate.offer} field="monthly_cost" label={candidate.offer.route.provider_name || candidate.offer.route.provider} currency={feed.currency} active={false} />
            <p>{t('model_comparison.recommend.score', { score: candidate.quality })}</p>
            <p>{t(`model_comparison.recommend.why_${kinds[0] ?? 'balanced'}`)}</p>
            <p>{t(candidate.report ? 'model_comparison.recommend.synthetic' : 'model_comparison.recommend.catalogue', { count: candidate.report?.cases.length ?? 0, date: candidate.report?.created_at.slice(0, 10) ?? '' })}</p>
            <details><summary>{t('model_comparison.workspace.evidence')}</summary>
            <p>{t('model_comparison.recommend.benchmark', { metrics: metrics(candidate), date: feed.fetched_at.slice(0, 10) })}</p>
            {candidate.variantCount > 1 && <p>{t('model_comparison.recommend.variants', { count: candidate.variantCount })}</p>}
            {candidate.sampleCostPerSuccess !== null && <p>{t('model_comparison.recommend.sample_cost', { cost: money(candidate.sampleCostPerSuccess) })}</p>}
            {candidate.sampleLatency !== null && <p>{t('model_comparison.recommend.sample_time', { seconds: (candidate.sampleLatency / 1000).toFixed(2) })}</p>}
            <p>{t('model_comparison.recommend.history', history(candidate))}</p>
            <p>{t(`model_comparison.recommend.pending_${task.role}`)}</p>
            </details>
            {(onConfigure || onAssign) && <div className="model-task-choice__actions">
                {onConfigure && <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={disabled}
                    onClick={() => { onConfigure(candidate); }}>{t('model_comparison.workspace.configure_offer')}</button>}
                {onAssign && registry.some(row => row.enabled && row.provider === candidate.offer.route.provider && row.model_id === candidate.offer.route.model_id)
                    && <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={disabled}
                        onClick={() => { onAssign(candidate); }}>{t('model_comparison.workspace.assign', { name: botName })}</button>}
            </div>}
        </> : <p>{t('model_comparison.recommend.empty')}</p>}
    </article>;
    return <section className="ai-resource-card model-task-recommendations" aria-label={t('model_comparison.recommend.title')}>
        <header className="model-task-recommendations__header"><h3>{t('model_comparison.recommend.title')}</h3><RefreshButton onClick={() => { setReload(value => value + 1); }} /></header>

        <div className="ai-resource-editor__grid model-task-recommendations__fields">
            <label>{t('model_comparison.recommend.task')}<select className="gnosi-select" value={task.id} onChange={event => {
                const next = tasks.find(item => item.id === event.target.value);
                if (!next) return;
                setTaskId(next.id); setInput(String(next.input)); setOutput(String(next.output)); setContext(String(next.context)); setBudget(next.id === 'book' ? String(Number((.5 * feed.currency.usd_rate).toFixed(2))) : '');
            }}>{tasks.map(item => <option key={item.id} value={item.id}>{t(`model_comparison.recommend.tasks.${item.id}`)}</option>)}</select></label>
            {field('input', input, setInput)}{field('output', output, setOutput)}{field('budget', budget, setBudget)}
        </div>
        <p className="settings-desc">{t('model_comparison.workspace.examples', { count: number(attempts) })}</p>
        <details className="model-task-recommendations__requirements"><summary>{t('model_comparison.workspace.requirements')}</summary>
            <div className="ai-resource-editor__grid model-task-recommendations__fields">{field('context', context, setContext)}{field('minimum', minimum, setMinimum, 100)}{field('attempts', attempts, setAttempts, 10)}</div>
            <p className="settings-desc">{t('model_comparison.recommend.volume_help')}</p>
            <p className="settings-desc">{t('model_comparison.recommend.help')}</p>
        </details>
        {evidence.vault === vault && evidence.error && <p role="alert">{t('model_comparison.recommend.evidence_error')}</p>}
        {!valid ? <p role="alert">{t('model_comparison.recommend.invalid')}</p> : <>
            {sameOffer && <p className="model-configuration-banner">{t('model_comparison.recommend.same_offer')}</p>}
            <div className="model-task-recommendations__choices">{choices.map(choice => render(choice.candidate, choice.kinds))}</div>
            <details><summary>{t('model_comparison.recommend.exclusions')}</summary>
                <ul>{Object.entries(result.excluded).filter(([, count]) => count > 0).map(([reason, count]) => <li key={reason}>{t(`model_comparison.recommend.excluded.${reason}`, { count })}</li>)}</ul>
            </details>
        </>}
    </section>;
}
