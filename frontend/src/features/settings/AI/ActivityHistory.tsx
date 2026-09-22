import { AgentExecutionHistory } from './AgentExecutionHistory';
import { subscribeWindowEvent, subscribeDocumentEvent } from '../../../shared/platform/browser-events';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { fetchAutomationRuns, type AutomationRunPage } from '../../../shared/api/ai-activity';
import type { SchedulerHistory } from '../../../shared/api/scheduler';
import { useActiveVaultId } from '../../../shared/hooks/useActiveVaultId';
import { CatalogError } from './AIResourcePrimitives';
import { operationStatusLabel, toolDisplayName } from './aiResourceI18n';
import type { AIResourceAgent, AIResourcesController } from './aiResourceSettingsTypes';
import { jsonString } from './aiResourcesApi';
import { OperationsHistoryPanel } from './AIOperationsHistoryPanel';
import { ActivityJobResult } from './ActivityJobResult';
import { operationResources } from '../global-settings/aiOperationsBridge';
import { systemRunResult } from './activityHistoryPresentation';
import { ActivityRunReference } from './ActivityRunReference';

interface HistoryItem {
    id: string; name: string; origin: 'personal' | 'system' | 'manual'; status: string;
    time: number; finished?: number | null; agent?: string; error?: string | null;
    result?: string; jobId?: string; systemTask?: string; diagnostic?: string | null;
    automationId?: string; calls?: number; confirmations?: number; duration?: number | null;
}

export function ActivityHistory({ canEdit, aiEnabled, resources, agents, systemHistory, systemHistoryMore, systemDiagnostics, systemHistoryError }: {
    readonly canEdit: boolean; readonly aiEnabled: boolean; readonly resources: AIResourcesController; readonly agents: readonly AIResourceAgent[];
    readonly systemHistory: SchedulerHistory['items']; readonly systemHistoryMore: ReactNode;
    readonly systemDiagnostics: ReactNode; readonly systemHistoryError: string;
}) {
    const { t, i18n } = useTranslation();
    const vaultId = useActiveVaultId();
    const [params, setParams] = useSearchParams();
    const automationId = params.get('automation') || '';
    const [page, setPage] = useState<AutomationRunPage>({ runs: [], total: 0, offset: 0 });
    const [offset, setOffset] = useState(0);
    const [version, setVersion] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [origin, setOrigin] = useState('all');
    const [status, setStatus] = useState('all');
    const [agent, setAgent] = useState('all');
    const [since, setSince] = useState('');
    const [until, setUntil] = useState('');
    const [technical, setTechnical] = useState(false);
    useEffect(() => {
        if (!aiEnabled) return;
        const controller = new AbortController();
        void Promise.resolve().then(() => {
            if (controller.signal.aborted) return;
            setLoading(true); setError('');
            return fetchAutomationRuns(offset, automationId, controller.signal).then(result => {
                if (!controller.signal.aborted) setPage(result);
            }).catch((failure: unknown) => { if (!controller.signal.aborted) { setError(String(failure)); setPage({ runs: [], total: 0, offset: 0 }); } })
                .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        });
        const refresh = () => { if (document.visibilityState === 'visible') setVersion(value => value + 1); };
        const timer = window.setInterval(refresh, 20000);
        const stopFocus = subscribeWindowEvent('focus', refresh);
        const stopVisibility = subscribeDocumentEvent('visibilitychange', refresh);
        return () => { controller.abort(); window.clearInterval(timer); stopFocus(); stopVisibility(); };
    }, [aiEnabled, automationId, offset, vaultId, version]);
    const items: HistoryItem[] = [
        ...(aiEnabled ? page.runs.map(run => ({ id: `automation:${run.id}`, name: run.automation_name, origin: 'personal' as const, status: resources.approvals.some(approval => approval.session_id === `automation-${run.automation_id}` && typeof approval.created_at === 'number' && approval.created_at >= run.started_at && approval.created_at <= (run.finished_at || Date.now() / 1000)) ? 'awaiting_approval' : run.status, result: run.result_text, time: run.started_at * 1000, finished: run.finished_at ? run.finished_at * 1000 : null, agent: run.agent_id, error: run.error_code, automationId: run.automation_id, calls: run.ai_calls, confirmations: run.confirmation_count })) : []),
        ...systemHistory.filter(run => technical || run.task_name !== 'run_capability_automations').map(run => {
            const name = t(`dashboard.tasks.${run.task_name}.title`, { defaultValue: run.task_name.replaceAll('_', ' ') });
            return { id: `system:${run.id}`, name, systemTask: run.task_name, origin: 'system' as const, status: run.status, time: new Date(run.started_at || 0).getTime(), result: systemRunResult(t, run, name), diagnostic: run.message, duration: run.duration_seconds };
        }),
        ...(aiEnabled ? resources.jobs.map(job => ({ id: `job:${String(job.job_id)}`, jobId: String(job.job_id), name: t('activity.background_job', { provider: jsonString(job.provider) || '' }), origin: 'manual' as const, status: jsonString(job.status) || jsonString(job.state) || 'unknown', time: typeof job.created_at === 'number' ? job.created_at * 1000 : 0, error: jsonString(job.error_code) })) : []),
    ];
    const filtered = items.filter(item => (!automationId || item.automationId === automationId)
        && (origin === 'all' || item.origin === origin) && (status === 'all' || item.status === status)
        && (agent === 'all' || item.agent === agent)
        && (!since || item.time >= new Date(`${since}T00:00:00`).getTime()) && (!until || item.time <= new Date(`${until}T23:59:59.999`).getTime()))
        .sort((a, b) => b.time - a.time);
    return <div className="ai-resources-panel">
        {aiEnabled && !automationId && <AgentExecutionHistory key={vaultId} canEdit={canEdit} />}
        <div className="flex justify-end"><RefreshButton onClick={() => { setVersion(value => value + 1); void resources.reload(); }} /></div>
        <div className="ai-resources-toolbar">
            <label>{t('activity.origin')}<select className="gnosi-select" value={origin} onChange={event => { setOrigin(event.target.value); }}>{['all', 'personal', 'system', 'manual'].map(value => <option key={value} value={value}>{t(`activity.${value}`)}</option>)}</select></label>
            <label>{t('activity.status')}<select className="gnosi-select" value={status} onChange={event => { setStatus(event.target.value); }}><option value="all">{t('activity.all')}</option>{[...new Set(items.map(item => item.status))].map(value => <option key={value} value={value}>{operationStatusLabel(t, value)}</option>)}</select></label>
            <label>{t('settings.ai.operations.agent')}<select className="gnosi-select" value={agent} onChange={event => { setAgent(event.target.value); }}><option value="all">{t('activity.all')}</option>{agents.map(value => <option key={value.id} value={value.id}>{value.name || value.id}</option>)}</select></label>
        </div>
        <div className="ai-history-filters">
            <label>{t('activity.from')}<input className="gnosi-input" type="date" value={since} onChange={event => { setSince(event.target.value); }} /></label>
            <label>{t('activity.to')}<input className="gnosi-input" type="date" value={until} onChange={event => { setUntil(event.target.value); }} /></label>
            <div className="inline-flex items-center gap-2"><GnosiToggle active={technical} onChange={() => { setTechnical(value => !value); }} label={t('activity.internal_activity')} /><span>{t('activity.internal_activity')}</span></div>
            {automationId && <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { setOffset(0); setParams({ tab: 'history' }); }}>{t('activity.clear_automation_filter')}</button>}
        </div>
        <p className="ai-resource-muted">{t('activity.loaded_history_help')}</p>
        <CatalogError error={error || resources.error || ''} onRetry={async () => { setVersion(value => value + 1); await resources.reload(); }} />
        {resources.resourceErrors.jobs && <CatalogError error={resources.resourceErrors.jobs} onRetry={resources.reload} />}
        {loading && <p role="status">{t('common.loading')}</p>}
        <div className="ai-resource-list">{filtered.map(item => <article className="ai-resource-card" key={item.id}>
            <div className="ai-resource-card__main"><span className="ai-resource-card__copy"><strong>{item.name}</strong><span>{t(`activity.${item.origin}`)} · {operationStatusLabel(t, item.status)}</span><span className="ai-resource-card__meta">{item.time > 0 && new Date(item.time).toLocaleString(i18n.resolvedLanguage)}{item.agent && ` · ${agents.find(value => value.id === item.agent)?.name || item.agent}`}</span></span></div>
            <details className="ai-resource-details"><summary>{t('activity.result_details')}</summary>
                {item.jobId && <ActivityJobResult jobId={item.jobId} status={item.status} canEdit={canEdit} onChanged={resources.reload} />}
                {item.result && <p style={{ whiteSpace: 'pre-wrap' }}>{item.result}</p>}
                {item.error && <p>{item.error}</p>}
                {item.finished && <p>{t('activity.duration', { seconds: ((item.finished - item.time) / 1000).toFixed(1) })}</p>}
                {item.duration != null && <p>{item.duration < 1 ? t('activity.duration_under_second') : t('activity.duration', { seconds: item.duration.toFixed(1) })}</p>}
                {item.calls != null && <p>{t('activity.calls', { count: item.calls })}</p>}
                {item.confirmations != null && <p>{t('activity.confirmations', { count: item.confirmations })}</p>}
                {item.systemTask && <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { setParams({ tab: 'schedulers', kind: 'system', task: item.systemTask || '' }); }}>{t('activity.view_schedule')}</button>}
                {item.automationId && <>
                    <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={() => { setParams({ tab: 'schedulers', kind: 'personal', automation: item.automationId || '' }); }}>{t('activity.view_schedule')}</button>
                    <h4>{t('activity.tool_activity')}</h4>
                    {resources.resourceErrors.audit ? <CatalogError error={resources.resourceErrors.audit} onRetry={resources.reload} /> : resources.auditEvents.filter(event => event.session_id === `automation-${item.automationId || ''}` && typeof event.created_at === 'number' && event.created_at * 1000 >= item.time && event.created_at * 1000 <= (item.finished || Date.now())).map(event => <p key={String(event.id)}>{toolDisplayName(t, resources.tools.find(tool => tool.id === event.tool_id || tool.id.endsWith(`.${String(event.tool_name).replaceAll('_', '-')}`)) ?? { name: String(event.tool_name) })} · {operationStatusLabel(t, String(event.status))}</p>)}
                </>}
                <ActivityRunReference id={item.id} name={item.name} diagnostic={item.diagnostic || item.error} />
            </details>
        </article>)}</div>
        {!loading && !error && !resources.error && !resources.resourceErrors.jobs && !systemHistoryError && filtered.length === 0 && <p>{t('activity.no_runs')}</p>}
        {aiEnabled && <div className="ai-resource-card__actions"><span>{t('activity.personal_history', { total: page.total, offset: page.offset })}</span><button type="button" disabled={loading || offset === 0} onClick={() => { setOffset(value => Math.max(0, value - 50)); }}>{t('common.previous')}</button><button type="button" disabled={loading || offset + 50 >= page.total} onClick={() => { setOffset(value => value + 50); }}>{t('common.next')}</button></div>}
        <h4>{t('activity.system_history')}</h4>
        {systemHistoryError && <p role="alert">{systemHistoryError}</p>}
        {systemHistoryMore}
        {technical && systemDiagnostics}
        {technical && aiEnabled && <OperationsHistoryPanel resources={operationResources(resources)} section="audit" />}
    </div>;
}
