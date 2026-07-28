import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CalendarRange, RefreshCw, Route, Wallet } from 'lucide-react';
import { VaultTimeline } from '../components/Vault/VaultTimeline';
import { usePlugins } from '../plugins/usePlugins';
import { AppHeader } from '../components/AppHeader';

export default function ProjectPlanningPage() {
    const { t } = useTranslation();
    const { getPluginSettings } = usePlugins();
    const planningSettings = getPluginSettings('project-planning');
    const [projects, setProjects] = useState([]);
    const [projectId, setProjectId] = useState('default');
    const [schedule, setSchedule] = useState(null);
    const [allocation, setAllocation] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [baselines, setBaselines] = useState([]);
    const [worklogs, setWorklogs] = useState([]);
    const [proposal, setProposal] = useState(null);
    const [baselineName, setBaselineName] = useState('');
    const [worklog, setWorklog] = useState({ task_id: '', date: '', hours: '' });

    useEffect(() => {
        const tableId = planningSettings.project_table_id;
        if (!tableId) {
            setProjects([]);
            setProjectId('default');
            return;
        }
        let active = true;
        axios.get(`/api/vault/pages/by-table/${encodeURIComponent(tableId)}`, { params: { include_templates: false } })
            .then((response) => {
                if (!active) return;
                const next = Array.isArray(response.data) ? response.data : [];
                setProjects(next);
                setProjectId((current) => next.some((project) => project.id === current) ? current : (next[0]?.id || 'default'));
            })
            .catch(() => { if (active) setProjects([]); });
        return () => { active = false; };
    }, [planningSettings.project_table_id]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [scheduleResponse, allocationResponse] = await Promise.all([
                axios.get(`/api/planning/projects/${encodeURIComponent(projectId)}/schedule`),
                axios.get('/api/planning/allocation'),
            ]);
            setSchedule(scheduleResponse.data);
            setAllocation(allocationResponse.data);
            const [baselineResponse, worklogResponse] = await Promise.all([
                axios.get(`/api/planning/projects/${encodeURIComponent(projectId)}/baselines`), axios.get('/api/planning/worklogs'),
            ]);
            setBaselines(baselineResponse.data.baselines || []);
            setWorklogs(worklogResponse.data.worklogs || []);
            setError('');
        } catch (requestError) {
            setError(t('planning_page.load_error', 'Could not load the project schedule.'));
        } finally {
            setLoading(false);
        }
    }, [projectId, t]);

    useEffect(() => { void load(); }, [load]);
    const diagnostics = schedule?.diagnostics || [];
    const tasks = schedule?.tasks || [];
    const ganttNotes = tasks.map((task) => ({
        id: task.id,
        title: task.title,
        metadata: { Schedule: { start: task.start, end: task.end } },
    }));
    const createBaseline = async () => { if (!baselineName.trim() || !schedule?.scheduleRevision) return; await axios.post(`/api/planning/projects/${encodeURIComponent(projectId)}/baselines`, { name: baselineName, schedule_revision: schedule.scheduleRevision }); setBaselineName(''); void load(); };
    const addWorklog = async () => { if (!worklog.task_id || !worklog.date || !worklog.hours) return; await axios.post('/api/planning/worklogs', { ...worklog, hours: Number(worklog.hours) }); setWorklog({ task_id: '', date: '', hours: '' }); void load(); };
    const createProposal = async () => { const response = await axios.post(`/api/planning/projects/${encodeURIComponent(projectId)}/leveling/proposals`); setProposal(response.data); };
    const applyProposal = async () => { if (!proposal) return; await axios.post(`/api/planning/leveling/proposals/${proposal.id}/apply`, { schedule_revision: proposal.scheduleRevision, etags: proposal.sourceEtags || {} }); setProposal(null); void load(); };
    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-secondary)] text-[var(--text-primary)]">
            <AppHeader
                icon={CalendarRange}
                title={t('planning_page.title', 'Project planning')}
                subtitle={t('planning_page.subtitle', 'Schedule, critical path, resources and planning diagnostics.')}
            >
                <select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label={t('planning_page.project', 'Project')} className="gnosi-button gnosi-button--secondary max-w-56 bg-[var(--bg-primary)] text-sm">{projects.length === 0 ? <option value="default">{t('planning_page.default_project', 'Default project')}</option> : projects.map((project) => <option key={project.id} value={project.id}>{project.title || project.id}</option>)}</select>
                <button onClick={() => void load()} className="gnosi-button gnosi-button--primary"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />{t('planning_page.refresh', 'Refresh')}</button>
            </AppHeader>
        <main className="mx-auto w-full max-w-7xl flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
            {error && <p className="rounded border border-red-400 p-3 text-sm text-red-600">{error}</p>}
            <section className="grid gap-4 md:grid-cols-3">
                <article className="gnosi-panel p-4"><Route size={18} /><p className="mt-2 text-sm text-[var(--text-tertiary)]">{t('planning_page.critical_tasks', 'Critical tasks')}</p><strong className="text-2xl">{schedule?.criticalTaskIds?.length || 0}</strong></article>
                <article className="gnosi-panel p-4"><Wallet size={18} /><p className="mt-2 text-sm text-[var(--text-tertiary)]">{t('planning_page.estimated_cost', 'Estimated cost')}</p><strong className="text-2xl">{allocation?.total_estimated_cost ?? '—'}</strong></article>
                <article className="gnosi-panel p-4"><AlertTriangle size={18} /><p className="mt-2 text-sm text-[var(--text-tertiary)]">{t('planning_page.warnings', 'Warnings')}</p><strong className="text-2xl">{diagnostics.length + (allocation?.warnings?.length || 0)}</strong></article>
            </section>
            <section className="gnosi-panel p-4"><h2 className="mb-3 text-lg font-medium">{t('planning_page.schedule', 'Schedule')}</h2>{loading ? <p role="status" aria-live="polite">{t('common.loading', 'Loading...')}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b"><th className="p-2">{t('planning_page.task', 'Task')}</th><th className="p-2">{t('planning_page.start', 'Start')}</th><th className="p-2">{t('planning_page.finish', 'Finish')}</th><th className="p-2">{t('planning_page.slack', 'Slack')}</th></tr></thead><tbody>{tasks.map((task) => <tr className="border-b" key={task.id}><td className={task.critical ? 'p-2 font-semibold text-red-600' : 'p-2'}>{task.title}</td><td className="p-2">{task.start}</td><td className="p-2">{task.end}</td><td className="p-2">{task.freeSlackMinutes}</td></tr>)}</tbody></table></div>}</section>
            {tasks.length > 0 && <section className="h-[620px] overflow-hidden rounded border bg-[var(--bg-primary)]"><VaultTimeline notes={ganttNotes} schema={{ Schedule: 'period' }} activeView={{ dateField: 'Schedule', endDateField: 'Schedule' }} idToTitle={Object.fromEntries(tasks.map((task) => [task.id, task.title]))} /></section>}
            <section className="grid gap-4 lg:grid-cols-2"><article className="gnosi-panel p-4"><h2 className="mb-3 text-lg font-medium">{t('planning_page.baselines', 'Baselines')}</h2><div className="flex flex-wrap gap-2"><input value={baselineName} onChange={(event) => setBaselineName(event.target.value)} placeholder={t('planning_page.baseline_name', 'Baseline name')} className="min-h-10 min-w-0 flex-1 rounded border bg-[var(--bg-primary)] px-2" /><button onClick={() => void createBaseline()} className="gnosi-button gnosi-button--secondary">{t('planning_page.create', 'Create')}</button></div><ul className="mt-3 text-sm">{baselines.map((baseline) => <li key={baseline.id}>{baseline.name} · r{baseline.scheduleRevision}</li>)}</ul></article><article className="gnosi-panel p-4"><h2 className="mb-3 text-lg font-medium">{t('planning_page.worklogs', 'Work logs')}</h2><div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><select value={worklog.task_id} onChange={(event) => setWorklog({ ...worklog, task_id: event.target.value })} className="min-h-10 rounded border bg-[var(--bg-primary)]"><option value="">{t('planning_page.task', 'Task')}</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select><input type="date" value={worklog.date} onChange={(event) => setWorklog({ ...worklog, date: event.target.value })} className="min-h-10 rounded border bg-[var(--bg-primary)]" /><input type="number" step="0.25" value={worklog.hours} onChange={(event) => setWorklog({ ...worklog, hours: event.target.value })} className="min-h-10 rounded border bg-[var(--bg-primary)]" /></div><button onClick={() => void addWorklog()} className="gnosi-button gnosi-button--secondary mt-2">{t('planning_page.add_worklog', 'Add work log')}</button><p className="mt-2 text-sm text-[var(--text-tertiary)]">{worklogs.length} {t('planning_page.entries', 'entries')}</p></article></section>
            <section className="grid gap-4 lg:grid-cols-2"><article className="rounded border bg-[var(--bg-primary)] p-4"><h2 className="mb-3 text-lg font-medium">{t('planning_page.resource_heatmap', 'Resource load')}</h2><div className="grid grid-cols-7 gap-1">{(allocation?.buckets || []).map((bucket) => <div key={`${bucket.resource_id}-${bucket.date}`} title={`${bucket.resource_name}: ${bucket.assigned_hours}/${bucket.capacity_hours} h`} className={`rounded p-2 text-xs ${bucket.overallocated_hours ? 'bg-red-500 text-white' : 'bg-emerald-100 text-emerald-900'}`}>{bucket.resource_name}<br />{bucket.date}<br />{bucket.assigned_hours}h</div>)}</div></article><article className="rounded border bg-[var(--bg-primary)] p-4"><h2 className="mb-3 text-lg font-medium">{t('planning_page.leveling', 'Resource leveling')}</h2><button onClick={() => void createProposal()} className="rounded border px-3 py-1">{t('planning_page.generate_proposal', 'Generate proposal')}</button>{proposal && <div className="mt-3 text-sm"><p>{proposal.proposals?.length || 0} {t('planning_page.proposed_changes', 'proposed changes')}</p><button onClick={() => void applyProposal()} className="mt-2 rounded bg-[var(--accent-primary)] px-3 py-1 text-white">{t('planning_page.apply_proposal', 'Apply proposal')}</button></div>}<ul className="mt-3 text-sm">{(allocation?.assignment_summaries || []).map((assignment) => <li key={assignment.id}>{assignment.task_id}: {assignment.planned_work_hours}h · {assignment.estimated_cost}</li>)}</ul></article></section>
            {diagnostics.length > 0 && <section className="rounded border bg-[var(--bg-primary)] p-4"><h2 className="mb-2 text-lg font-medium">{t('planning_page.diagnostics', 'Diagnostics')}</h2><ul className="space-y-1 text-sm">{diagnostics.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}</ul></section>}
        </main>
        </div>
    );
}
