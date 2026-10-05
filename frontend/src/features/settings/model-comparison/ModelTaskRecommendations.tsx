import type { botModelDemand } from './botModelDemand';
import './ModelTaskRecommendations.css';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiModelComparison, AiModelComparisonEntry, AiModelRegistryEntry } from '../../../shared/api/ai';
import { fetchAgentRuns, fetchRoleEvaluations, fetchTaskEvaluations, fetchTaskEvaluationSuite, type AgentExecutionRun, type RoleEvaluationReport, type TaskEvaluationReport, type TaskEvaluationSuite } from '../../../shared/api/ai-activity';
import { useActiveVaultId } from '../../../shared/hooks/useActiveVaultId';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import { formatComparisonCost } from '../modelComparison';
import { ModelPriceOffer } from './ModelPriceOffer';
import { recommendTask, TASKS, taskMinimum, type Candidate, type TaskId } from './taskRecommendations';
import { operationalEvidence } from './operationalEvidence';
import { ModelTaskEvaluation } from './ModelTaskEvaluation';
import { ModelTaskEvaluationChooser } from './ModelTaskEvaluationChooser';

export interface TaskRecommendationDraft {
    manual?: boolean; taskId: TaskId; input: string; output: string; context: string; minimum: string; budget: string; attempts: string;
}

export function ModelTaskRecommendations({ models, feed, provider, profile, revision, initialTask, botDemand, registry = [], onConfigure, onAssign, botName, botId, currentRoute, disabled = false, initialDraft, onDraftChange }: {
    readonly models: readonly AiModelComparisonEntry[];
    readonly feed: AiModelComparison;
    readonly provider: string;
    readonly profile: string;
    readonly revision: number;
    readonly initialTask?: TaskId;
    readonly botDemand?: ReturnType<typeof botModelDemand>;
    readonly registry?: readonly AiModelRegistryEntry[];
    readonly onConfigure?: (candidate: Candidate) => void;
    readonly onAssign?: (candidate: Candidate) => void;
    readonly botName?: string;
    readonly botId?: string;
    readonly currentRoute?: { provider: string; model: string };
    readonly disabled?: boolean;
    readonly initialDraft?: TaskRecommendationDraft;
    readonly onDraftChange?: (draft: TaskRecommendationDraft) => void;
}) {
    const { t } = useTranslation();
    const vault = useActiveVaultId();
    const tasks = TASKS.filter(task => profile === 'all' || profile === 'unrated' || task.role === profile);
    const initial = tasks.find(task => task.id === (initialTask ?? 'book')) ?? tasks[0] ?? TASKS[0];
    const detected = TASKS.filter(item => botDemand?.tasks.includes(item.id));
    const [manual, setManual] = useState(initialDraft?.manual ?? !botDemand);
    const [taskId, setTaskId] = useState<TaskId>(initialDraft?.taskId ?? initial.id);
    const task = tasks.find(item => item.id === taskId) ?? initial;
    const [input, setInput] = useState(initialDraft?.input ?? (String(!manual && detected.length ? Math.max(...detected.map(item => item.input)) : task.input)));
    const [output, setOutput] = useState(initialDraft?.output ?? (String(!manual && detected.length ? Math.max(...detected.map(item => item.output)) : task.output)));
    const [context, setContext] = useState(initialDraft?.context ?? (String(!manual && detected.length ? Math.max(...detected.map(item => item.context)) : task.context)));
    const demands = !manual && detected.length ? detected : [task];
    const [minimum, setMinimum] = useState(initialDraft?.minimum ?? String(taskMinimum(demands)));
    const [budget, setBudget] = useState(initialDraft?.budget ?? (demands.some(item => item.id === 'book') ? String(Number((.5 * feed.currency.usd_rate).toFixed(2))) : ''));
    const [attempts, setAttempts] = useState(initialDraft?.attempts ?? ('2'));
    useEffect(() => { onDraftChange?.({ manual, taskId, input, output, context, minimum, budget, attempts }); },
        [manual, taskId, input, output, context, minimum, budget, attempts, onDraftChange]);
    const [reload, setReload] = useState(0);
    const [evidence, setEvidence] = useState<{ vault: string; reports: RoleEvaluationReport[]; runs: AgentExecutionRun[]; taskReports: TaskEvaluationReport[]; suite?: TaskEvaluationSuite; error: boolean; checkedAt: number }>({ vault: '', reports: [], runs: [], taskReports: [], error: false, checkedAt: 0 });
    useEffect(() => {
        const controller = new AbortController();
        void Promise.allSettled([fetchRoleEvaluations(controller.signal), fetchAgentRuns(controller.signal), fetchTaskEvaluations(controller.signal), fetchTaskEvaluationSuite(controller.signal)]).then(([reports, runs, taskReports, suite]) => {
            if (!controller.signal.aborted) setEvidence({ vault, checkedAt: Date.now(),
                reports: reports.status === 'fulfilled' ? reports.value : [], runs: runs.status === 'fulfilled' ? runs.value : [],
                taskReports: taskReports.status === 'fulfilled' ? taskReports.value : [], suite: suite.status === 'fulfilled' ? suite.value : undefined,
                error: reports.status === 'rejected' || runs.status === 'rejected' || taskReports.status === 'rejected' || suite.status === 'rejected' });
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
        task, tasks: !manual && detected.length ? detected : undefined, needsTools: !manual && botDemand?.needsTools, input: number(input), output: number(output), context: !manual && detected.length ? Math.max(number(context), ...detected.map(item => item.context)) : number(context),
        minimumQuality: number(minimum), budgetUsd: budget.trim() ? number(budget) / feed.currency.usd_rate : null,
        attempts: number(attempts),
    }, reports, evidence.checkedAt, evidence.vault === vault && evidence.suite ? { reports: evidence.taskReports, suite: evidence.suite } : undefined);
    const choices: { candidate: Candidate | undefined; kinds: string[] }[] = [];
    for (const [kind, candidate] of [['balanced', result.balanced], ['cheapest', result.cheapest], ['quality', result.quality]] as const) {
        const match = candidate && choices.find(choice => choice.candidate?.offer.route.provider === candidate.offer.route.provider
            && choice.candidate.offer.route.model_id === candidate.offer.route.model_id
            && choice.candidate.offer.cost === candidate.offer.cost && choice.candidate.offer.plan === candidate.offer.plan);
        if (match) match.kinds.push(kind);
        else choices.push({ candidate, kinds: [kind] });
    }
    const toggleSimulation = () => {
        setManual(value => !value);
        if (manual && detected.length) {
            setInput(String(Math.max(...detected.map(item => item.input))));
            setOutput(String(Math.max(...detected.map(item => item.output))));
            setContext(String(Math.max(...detected.map(item => item.context))));
            setMinimum(String(taskMinimum(detected)));
            setBudget(detected.some(item => item.id === 'book') ? String(Number((.5 * feed.currency.usd_rate).toFixed(2))) : '');
        }
    };
    const sameOffer = choices.length === 1 && Boolean(choices[0]?.candidate);
    const money = (value: number) => formatComparisonCost(value * feed.currency.usd_rate, feed.currency.symbol);
    const field = (key: string, value: string, set: (v: string) => void, max?: number) => <label>
        {t(`model_comparison.recommend.${key}`, { symbol: feed.currency.symbol })}
        <input className="gnosi-input" type="number" min="0" max={max} step={key === 'budget' ? '0.01' : '1'} value={value} onChange={event => { set(event.target.value); }} />
    </label>;
    const history = (candidate: Candidate) => operationalEvidence(evidence.vault === vault ? evidence.runs : [], candidate.offer.route.provider, candidate.offer.route.model_id);
    const metrics = (candidate: Candidate) => (!manual && detected.length ? detected : [task]).map(item =>
        `${t(`model_comparison.recommend.tasks.${item.id}`)}: ${Object.entries(item.weights).map(([key, weight]) => {
            const value = candidate.model[key as 'intelligence' | 'coding' | 'agentic'];
            return `${t(`model_comparison.columns.${key}`)}: ${String(value)} (${String(Math.round(weight * 100))}%)`;
        }).join(' · ')}`).join('; ');
    const render = (candidate: Candidate | undefined, kinds: string[]) => <article className="ai-resource-card model-task-choice" key={kinds[0]}>
        <h3>{kinds.map(kind => t(`model_comparison.recommend.${kind}`)).join(' · ')}</h3>
        {candidate ? <>
            <strong>{candidate.model.name}</strong>
            <ModelPriceOffer offer={candidate.offer} field="monthly_cost" label={candidate.offer.route.provider_name || candidate.offer.route.provider} currency={feed.currency} active={false} />
            <p>{t('model_comparison.recommend.score', { score: candidate.quality })}</p>
            <p>{t(`model_comparison.recommend.why_${kinds[0] === 'balanced' && candidate.taskChecks?.complete ? 'balanced_checked' : kinds[0] ?? 'balanced'}`)}</p>
            <p>{t('model_comparison.tests.evidence', { measured: candidate.taskChecks?.cases.length ?? 0, total: candidate.taskChecks?.expected ?? 0 })}</p>
            <p>{t(candidate.taskChecks?.complete ? 'model_comparison.recommend.checked' : 'model_comparison.recommend.catalogue')}</p>
            {candidate.taskChecks?.stale && <p>{t('model_comparison.tests.old_result')}</p>}
            <details><summary>{t('model_comparison.workspace.evidence')}</summary>
            {candidate.report && <p>{t('model_comparison.recommend.synthetic', { count: candidate.report.cases.length, date: candidate.report.created_at.slice(0, 10) })}</p>}
            {candidate.taskChecks && <ul>{candidate.taskChecks.tasks.map(item => <li key={item.task}>{t(`model_comparison.recommend.tasks.${item.task}`)}: {item.passed}/{item.total} {t('model_comparison.tests.checked')}</li>)}</ul>}
            <p>{t('model_comparison.recommend.benchmark', { metrics: metrics(candidate), date: feed.fetched_at.slice(0, 10) })}</p>
            {candidate.variantCount > 1 && <p>{t('model_comparison.recommend.variants', { count: candidate.variantCount })}</p>}
            {candidate.sampleCostPerSuccess !== null && <p>{t('model_comparison.recommend.sample_cost', { cost: money(candidate.sampleCostPerSuccess) })}</p>}
            {candidate.sampleLatency !== null && <p>{t('model_comparison.recommend.sample_time', { seconds: (candidate.sampleLatency / 1000).toFixed(2) })}</p>}
            <p>{t('model_comparison.recommend.history', history(candidate))}</p>
            {[...new Set((!manual && detected.length ? detected : [task]).map(item => item.role))].map(role => <p key={role}>{t(`model_comparison.recommend.pending_${role}`)}</p>)}
            </details>
            {botId && <ModelTaskEvaluation agentId={botId} provider={candidate.offer.route.provider} model={candidate.offer.route.model_id}
                tasks={(!manual && detected.length ? detected : [task]).map(item => item.id)} currency={feed.currency}
                active={registry.some(row => row.enabled && row.provider === candidate.offer.route.provider && row.model_id === candidate.offer.route.model_id)}
                onComplete={() => { setReload(value => value + 1); }} />}
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
        <header className="model-task-recommendations__header"><h3>{t(botDemand ? 'model_comparison.workspace.bot_recommendations' : 'model_comparison.recommend.title')}</h3><RefreshButton onClick={() => { setReload(value => value + 1); }} /></header>

        {botDemand && <div className="settings-desc">
            <p>{t('model_comparison.workspace.detected_tasks')}: {detected.map(item => t(`model_comparison.recommend.tasks.${item.id}`)).join(' · ')}</p>
            {!manual && <p>{t('model_comparison.workspace.combined_quality')}</p>}
            <p>{t('model_comparison.workspace.detected_tools', { count: botDemand.tools.length })}</p>
            <details><summary>{t('model_comparison.workspace.assigned_skills')}</summary><ul>{[...new Set(botDemand.assigned)].map(name => <li key={name}>{name}</li>)}</ul></details>
            <details><summary>{t('model_comparison.tests.criteria')}</summary><ul>{detected.map(item => <li key={item.id}>
                <strong>{t(`model_comparison.recommend.tasks.${item.id}`)}</strong>: {evidence.suite?.criteria.filter(criterion => criterion.tasks.includes(item.id))
                    .map(criterion => t(`model_comparison.tests.metrics.${criterion.metric}`)).join(' · ') || t('model_comparison.tests.unmeasured')}
            </li>)}</ul><p>{t('model_comparison.tests.sources')}</p></details>
            {botDemand.unknown.length > 0 && <p role="status">{t('model_comparison.workspace.unknown_skills', { names: botDemand.unknown.join(', ') })}</p>}
            {manual && <p role="status">{t('model_comparison.workspace.manual_warning')}</p>}
        </div>}
        {botId && <ModelTaskEvaluationChooser agentId={botId} currentRoute={currentRoute} registry={registry} models={models}
            tasks={(!manual && detected.length ? detected : [task]).map(item => item.id)} currency={feed.currency}
            onComplete={() => { setReload(value => value + 1); }} />}
        <div className="ai-resource-editor__grid model-task-recommendations__fields">
            {field('input', input, setInput)}{field('output', output, setOutput)}{field('budget', budget, setBudget)}
        </div>
        <p className="settings-desc">{t('model_comparison.workspace.examples', { count: number(attempts) })}</p>
        <details className="model-task-recommendations__requirements"><summary>{t('model_comparison.workspace.requirements')}</summary>
            {botDemand && <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={toggleSimulation}>{t(manual ? 'model_comparison.workspace.automatic_mode' : 'model_comparison.workspace.manual_mode')}</button>}
            {manual && <div className="ai-resource-editor__grid model-task-recommendations__fields">
            <label>{t('model_comparison.recommend.task')}<select className="gnosi-select" value={task.id} onChange={event => {
                const next = tasks.find(item => item.id === event.target.value);
                if (!next) return;
                setTaskId(next.id); setInput(String(next.input)); setOutput(String(next.output)); setContext(String(next.context)); setMinimum(String(taskMinimum([next]))); setBudget(next.id === 'book' ? String(Number((.5 * feed.currency.usd_rate).toFixed(2))) : '');
            }}>{tasks.map(item => <option key={item.id} value={item.id}>{t(`model_comparison.recommend.tasks.${item.id}`)}</option>)}</select></label>
            </div>}
            <div className="ai-resource-editor__grid model-task-recommendations__fields">{field('context', context, setContext)}{field('minimum', minimum, setMinimum, 100)}{field('attempts', attempts, setAttempts, 10)}</div>
            <p className="settings-desc">{t('model_comparison.recommend.policy_help')}</p>
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
