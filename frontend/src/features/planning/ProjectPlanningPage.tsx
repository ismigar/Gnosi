import { pageReferenceTitle } from '../../shared/records/pageReferenceTitle';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CalendarRange, Route, Wallet } from 'lucide-react';

import { VaultTimeline } from '../../shared/record-views/VaultTimeline';
import { usePlugins } from '../../shared/plugins/usePlugins';
import { AppHeader } from '../../shared/ui/layout/AppHeader';
import {
    useApplyPlanningLevelingProposal,
    useCreatePlanningBaseline,
    useCreatePlanningLevelingProposal,
    useCreatePlanningWorklog,
    usePlanningAllocation,
    usePlanningBaselines,
    usePlanningWorklogs,
    useProjectSchedule,
    planningQueryKeys,
} from '../../shared/api/usePlanningData';
import type { PlanningLevelingProposal } from '../../shared/api/planning';
import { getActiveVaultId } from '../../shared/api/vault-context';
import type { VaultPageReference } from '../../shared/api/vaults';
import {
    fetchVaultPageReferencesByTable,
} from '../../shared/api/vaults';


function projectTableIdFromSettings(settings: unknown): string | undefined {
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
        return undefined;
    }
    const tableId = (settings as Record<string, unknown>).project_table_id;
    return typeof tableId === 'string' && tableId.trim() ? tableId : undefined;
}


interface PlanningTimelineProps {
    readonly activeView: {
        readonly dateField: string;
        readonly endDateField: string;
    };
    readonly idToTitle: Readonly<Record<string, string>>;
    readonly notes: readonly {
        readonly id: string;
        readonly metadata: {
            readonly Schedule: {
                readonly end: string | null | undefined;
                readonly start: string | null | undefined;
            };
        };
        readonly title: string;
    }[];
    readonly schema: Readonly<Record<string, string>>;
}


const PlanningTimeline = VaultTimeline as unknown as ComponentType<
    PlanningTimelineProps
>;

export default function ProjectPlanningPage() {
    const vaultId = getActiveVaultId();
    const { getPluginSettings, loaded: pluginsLoaded, loadError: pluginsLoadError } = usePlugins();
    const projectTableId = projectTableIdFromSettings(
        getPluginSettings('project-planning'),
    );
    const projectsQuery = useQuery({
        enabled: pluginsLoaded && Boolean(projectTableId),
        staleTime: 0,
        queryKey: planningQueryKeys.projectReferences(projectTableId ?? ''),
        queryFn: ({ signal }) => fetchVaultPageReferencesByTable(
            projectTableId ?? '',
            { include_templates: false },
            signal,
        ),
    });
    const [projectId, setProjectId] = useState('default');
    const visibleProjects = projectTableId ? projectsQuery.data ?? [] : [];
    const selectedProjectId = projectTableId
        ? visibleProjects.find((project) => project.id === projectId)?.id
            ?? visibleProjects[0]?.id ?? 'default'
        : 'default';
    const projectReady = pluginsLoaded && !pluginsLoadError
        && (!projectTableId || projectsQuery.isSuccess);
    return <ProjectPlanningProject
        key={JSON.stringify([vaultId, projectTableId, selectedProjectId])}
        selectedProjectId={selectedProjectId}
        projectReady={projectReady}
        visibleProjects={visibleProjects}
        setProjectId={setProjectId}
        projectsQuery={projectsQuery}
        projectTableId={projectTableId}
        pluginsLoaded={pluginsLoaded}
        pluginsLoadError={pluginsLoadError}
    />;
}

interface ProjectPlanningProjectProps {
    readonly selectedProjectId: string;
    readonly projectReady: boolean;
    readonly visibleProjects: readonly VaultPageReference[];
    readonly setProjectId: (projectId: string) => void;
    readonly projectsQuery: {
        readonly isFetching: boolean;
        readonly isError: boolean;
        readonly refetch: () => Promise<{ error: unknown }>;
    };
    readonly projectTableId: string | undefined;
    readonly pluginsLoaded: boolean;
    readonly pluginsLoadError: boolean;
}

function ProjectPlanningProject({
    selectedProjectId, projectReady, visibleProjects, setProjectId, projectsQuery,
    projectTableId, pluginsLoaded, pluginsLoadError,
}: ProjectPlanningProjectProps) {
    const { t } = useTranslation();
    const [error, setError] = useState('');
    const [proposal, setProposal] = useState<PlanningLevelingProposal | null>(null);
    const [baselineName, setBaselineName] = useState('');
    const [worklog, setWorklog] = useState({ task_id: '', date: '', hours: '' });
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const isMounted = () => mounted.current;
    const scheduleQuery = useProjectSchedule(selectedProjectId, projectReady);
    const allocationQuery = usePlanningAllocation(selectedProjectId, projectReady);
    const baselinesQuery = usePlanningBaselines(selectedProjectId, projectReady);
    const worklogsQuery = usePlanningWorklogs(selectedProjectId, projectReady);
    const createBaselineMutation = useCreatePlanningBaseline();
    const createWorklogMutation = useCreatePlanningWorklog();
    const createProposalMutation = useCreatePlanningLevelingProposal();
    const applyProposalMutation = useApplyPlanningLevelingProposal();
    const schedule = projectReady ? scheduleQuery.data || null : null;
    const allocation = projectReady ? allocationQuery.data || null : null;
    const baselines = projectReady ? baselinesQuery.data?.baselines || [] : [];
    const worklogs = projectReady ? worklogsQuery.data?.worklogs || [] : [];
    const loading = !pluginsLoaded || projectsQuery.isFetching || scheduleQuery.isFetching
        || allocationQuery.isFetching
        || baselinesQuery.isFetching
        || worklogsQuery.isFetching;
    const loadError = pluginsLoadError || projectsQuery.isError || scheduleQuery.isError
        || allocationQuery.isError
        || baselinesQuery.isError
        || worklogsQuery.isError;

    const load = async () => {
        try {
            const results = await Promise.all([
                ...(projectReady ? [scheduleQuery.refetch(), baselinesQuery.refetch(), allocationQuery.refetch(), worklogsQuery.refetch()] : []),
                ...(projectTableId ? [projectsQuery.refetch()] : []),
            ]);
            if (!isMounted()) return;
            if (results.some((result) => result.error)) throw new Error('Planning refresh failed');
            setError('');
        } catch {
            if (!isMounted()) return;
            setError(t('planning_page.load_error', 'Could not load the project schedule.'));
        }
    };

    const diagnostics = schedule?.diagnostics || [];
    const tasks = schedule?.tasks || [];
    const ganttNotes = tasks.map((task) => ({
        id: task.id,
        title: pageReferenceTitle(task.id, {}, task.title),
        metadata: { Schedule: { start: task.start, end: task.end } },
    }));
    const mutationPending = createBaselineMutation.isPending || createWorklogMutation.isPending
        || createProposalMutation.isPending || applyProposalMutation.isPending;
    const showMutationError = (key: string, fallback: string) => {
        if (isMounted()) setError(t(key, fallback));
    };
    const createBaseline = async () => {
        if (!isMounted() || !projectReady || mutationPending || !baselineName.trim() || schedule?.scheduleRevision == null) return;
        try {
            await createBaselineMutation.mutateAsync({
                baseline: { name: baselineName, schedule_revision: schedule.scheduleRevision },
                projectId: selectedProjectId,
            });
            if (isMounted()) { setBaselineName(''); setError(''); }
        } catch {
            showMutationError('planning_page.baseline_error', 'Could not create the baseline.');
        }
    };
    const addWorklog = async () => {
        if (!isMounted() || !projectReady || mutationPending || !tasks.some((task) => task.id === worklog.task_id)
            || !worklog.date || !Number.isFinite(Number(worklog.hours)) || Number(worklog.hours) === 0) return;
        try {
            await createWorklogMutation.mutateAsync({ ...worklog, hours: Number(worklog.hours) });
            if (isMounted()) { setWorklog({ task_id: '', date: '', hours: '' }); setError(''); }
        } catch {
            showMutationError('planning_page.worklog_error', 'Could not add the work log.');
        }
    };
    const createProposal = async () => {
        if (!isMounted() || !projectReady || mutationPending) return;
        setProposal(null);
        try {
            const nextProposal = await createProposalMutation.mutateAsync(selectedProjectId);
            if (isMounted() && nextProposal.projectId === selectedProjectId) {
                setProposal(nextProposal);
                setError('');
            }
        } catch {
            showMutationError('planning_page.proposal_error', 'Could not generate the leveling proposal.');
        }
    };
    const applyProposal = async () => {
        if (!isMounted() || !projectReady || mutationPending || !proposal || proposal.projectId !== selectedProjectId) return;
        try {
            await applyProposalMutation.mutateAsync({
                proposal: {
                    schedule_revision: proposal.scheduleRevision,
                    etags: proposal.sourceEtags,
                },
                proposalId: proposal.id,
            });
            if (isMounted()) { setProposal(null); setError(''); }
        } catch {
            if (isMounted()) setProposal(null);
            showMutationError('planning_page.apply_error', 'Could not apply the proposal. Generate a new proposal and try again.');
        }
    };
    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
            <AppHeader
                icon={CalendarRange}
                title={t('planning_page.title', 'Project planning')}
                subtitle={t('planning_page.subtitle', 'Schedule, critical path, resources and planning diagnostics.')}
            >
                <select disabled={!projectReady} value={selectedProjectId} onChange={(event) => {
                    setProjectId(event.target.value);
                }} aria-label={t('planning_page.project', 'Project')} className="gnosi-button gnosi-button--secondary max-w-56 bg-[var(--bg-primary)] text-sm">{visibleProjects.length === 0 ? <option value="default">{t('planning_page.default_project', 'Default project')}</option> : visibleProjects.map((project) => <option key={project.id} value={project.id}>{pageReferenceTitle(project.id, {}, project.title)}</option>)}</select>
                <RefreshButton loading={loading} label={t('planning_page.refresh', 'Refresh')} onClick={() => void load()} />
            </AppHeader>
        <div className="mx-auto w-full max-w-7xl flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
            {(error || loadError) && <p className="rounded border border-red-400 p-3 text-sm text-red-700 dark:text-red-300" role="alert">{error || t('planning_page.load_error', 'Could not load the project schedule.')}</p>}
            <section className="grid gap-4 md:grid-cols-3">
                <article className="gnosi-panel p-4"><Route size={18} /><p className="mt-2 text-sm text-[var(--text-tertiary)]">{t('planning_page.critical_tasks', 'Critical tasks')}</p><strong className="text-2xl">{schedule?.criticalTaskIds.length ?? 0}</strong></article>
                <article className="gnosi-panel p-4"><Wallet size={18} /><p className="mt-2 text-sm text-[var(--text-tertiary)]">{t('planning_page.estimated_cost', 'Estimated cost')}</p><strong className="text-2xl">{allocation?.total_estimated_cost ?? '—'}</strong></article>
                <article className="gnosi-panel p-4"><AlertTriangle size={18} /><p className="mt-2 text-sm text-[var(--text-tertiary)]">{t('planning_page.warnings', 'Warnings')}</p><strong className="text-2xl">{diagnostics.length + (allocation?.warnings.length ?? 0)}</strong></article>
            </section>
            <section className="gnosi-panel p-4"><h2 className="mb-3 text-lg font-medium">{t('planning_page.schedule', 'Schedule')}</h2>{loading ? <p role="status" aria-live="polite">{t('common.loading', 'Loading...')}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b"><th className="p-2">{t('planning_page.task', 'Task')}</th><th className="p-2">{t('planning_page.start', 'Start')}</th><th className="p-2">{t('planning_page.finish', 'Finish')}</th><th className="p-2">{t('planning_page.slack', 'Slack')}</th></tr></thead><tbody>{tasks.map((task) => <tr className="border-b" key={task.id}><td className={task.critical ? 'p-2 font-semibold text-red-600' : 'p-2'}>{task.title}</td><td className="p-2">{task.start}</td><td className="p-2">{task.end}</td><td className="p-2">{task.freeSlackMinutes}</td></tr>)}</tbody></table></div>}</section>
            {tasks.length > 0 && <section className="h-[620px] overflow-hidden rounded border bg-[var(--bg-primary)]"><PlanningTimeline notes={ganttNotes} schema={{ Schedule: 'period' }} activeView={{ dateField: 'Schedule', endDateField: 'Schedule' }} idToTitle={Object.fromEntries(tasks.map((task) => [task.id, pageReferenceTitle(task.id, {}, task.title)]))} /></section>}
            <section className="grid gap-4 lg:grid-cols-2"><article className="gnosi-panel p-4"><h2 className="mb-3 text-lg font-medium">{t('planning_page.baselines', 'Baselines')}</h2><div className="flex flex-wrap gap-2"><input value={baselineName} onChange={(event) => {
                setBaselineName(event.target.value);
            }} placeholder={t('planning_page.baseline_name', 'Baseline name')} aria-label={t('planning_page.baseline_name', 'Baseline name')} className="min-h-10 min-w-0 flex-1 rounded border bg-[var(--bg-primary)] px-2" /><button disabled={!projectReady || mutationPending || scheduleQuery.isFetching} onClick={() => void createBaseline()} className="gnosi-button gnosi-button--secondary">{t('planning_page.create', 'Create')}</button></div><ul className="mt-3 text-sm">{baselines.map((baseline) => <li key={baseline.id}>{baseline.name} · r{baseline.scheduleRevision}</li>)}</ul></article><article className="gnosi-panel p-4"><h2 className="mb-3 text-lg font-medium">{t('planning_page.worklogs', 'Work logs')}</h2><div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><select value={worklog.task_id} onChange={(event) => {
                setWorklog({ ...worklog, task_id: event.target.value });
            }} aria-label={t('planning_page.worklog_task', 'Work log task')} className="min-h-10 rounded border bg-[var(--bg-primary)]"><option value="">{t('planning_page.task', 'Task')}</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select><input type="date" value={worklog.date} onChange={(event) => {
                setWorklog({ ...worklog, date: event.target.value });
            }} aria-label={t('planning_page.worklog_date', 'Work log date')} className="min-h-10 rounded border bg-[var(--bg-primary)]" /><input type="number" step="0.25" value={worklog.hours} onChange={(event) => {
                setWorklog({ ...worklog, hours: event.target.value });
            }} aria-label={t('planning_page.worklog_hours', 'Work log hours')} className="min-h-10 rounded border bg-[var(--bg-primary)]" /></div><button disabled={!projectReady || mutationPending || scheduleQuery.isFetching} onClick={() => void addWorklog()} className="gnosi-button gnosi-button--secondary mt-2">{t('planning_page.add_worklog', 'Add work log')}</button><p className="mt-2 text-sm text-[var(--text-tertiary)]">{worklogs.length} {t('planning_page.entries', 'entries')}</p></article></section>
            <section className="grid gap-4 lg:grid-cols-2"><article className="rounded border bg-[var(--bg-primary)] p-4"><h2 className="mb-3 text-lg font-medium">{t('planning_page.resource_heatmap', 'Resource load')}</h2><div className="grid grid-cols-7 gap-1">{(allocation?.buckets ?? []).map((bucket) => <div key={`${bucket.resource_id}-${bucket.date}`} title={`${bucket.resource_name}: ${String(bucket.assigned_hours)}/${String(bucket.capacity_hours)} h`} className={`rounded p-2 text-xs ${bucket.overallocated_hours ? 'bg-red-500 text-white' : 'bg-emerald-100 text-emerald-900'}`}>{bucket.resource_name}<br />{bucket.date}<br />{bucket.assigned_hours}h</div>)}</div></article><article className="rounded border bg-[var(--bg-primary)] p-4"><h2 className="mb-3 text-lg font-medium">{t('planning_page.leveling', 'Resource leveling')}</h2><button disabled={!projectReady || mutationPending} onClick={() => void createProposal()} className="rounded border px-3 py-1">{t('planning_page.generate_proposal', 'Generate proposal')}</button>{proposal && <div className="mt-3 text-sm"><p>{proposal.proposals.length} {t('planning_page.proposed_changes', 'proposed changes')}</p><button disabled={!projectReady || mutationPending} onClick={() => void applyProposal()} className="mt-2 rounded bg-[var(--accent-primary)] px-3 py-1 text-white">{t('planning_page.apply_proposal', 'Apply proposal')}</button></div>}<ul className="mt-3 text-sm">{(allocation?.assignment_summaries ?? []).map((assignment) => <li key={assignment.id}>{assignment.task_id}: {assignment.planned_work_hours}h · {assignment.estimated_cost}</li>)}</ul></article></section>
            {diagnostics.length > 0 && <section className="rounded border bg-[var(--bg-primary)] p-4"><h2 className="mb-2 text-lg font-medium">{t('planning_page.diagnostics', 'Diagnostics')}</h2><ul className="space-y-1 text-sm">{diagnostics.map((item, index) => <li key={`${item.code}-${String(index)}`}>{item.message}</li>)}</ul></section>}
        </div>
        </div>
    );
}
