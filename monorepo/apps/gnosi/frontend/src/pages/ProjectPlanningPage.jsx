import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw, Route, Wallet } from 'lucide-react';
import { VaultTimeline } from '../components/Vault/VaultTimeline';
import { usePlugins } from '../plugins/usePlugins';

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
    return (
        <main className="mx-auto max-w-7xl space-y-6 p-6">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div><h1 className="text-2xl font-semibold">{t('planning_page.title', 'Project planning')}</h1><p className="text-sm text-[var(--text-tertiary)]">{t('planning_page.subtitle', 'Schedule, critical path, resources and planning diagnostics.')}</p></div>
                <div className="flex gap-2"><select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label={t('planning_page.project', 'Project')} className="rounded border bg-[var(--bg-primary)] px-3 py-2 text-sm">{projects.length === 0 ? <option value="default">{t('planning_page.default_project', 'Default project')}</option> : projects.map((project) => <option key={project.id} value={project.id}>{project.title || project.id}</option>)}</select><button onClick={() => void load()} className="flex items-center gap-2 rounded bg-[var(--accent-primary)] px-3 py-2 text-sm text-white"><RefreshCw size={15} />{t('planning_page.refresh', 'Refresh')}</button></div>
            </header>
            {error && <p className="rounded border border-red-400 p-3 text-sm text-red-600">{error}</p>}
            <section className="grid gap-4 md:grid-cols-3">
                <article className="rounded border bg-[var(--bg-primary)] p-4"><Route size={18} /><p className="mt-2 text-sm text-[var(--text-tertiary)]">{t('planning_page.critical_tasks', 'Critical tasks')}</p><strong className="text-2xl">{schedule?.criticalTaskIds?.length || 0}</strong></article>
                <article className="rounded border bg-[var(--bg-primary)] p-4"><Wallet size={18} /><p className="mt-2 text-sm text-[var(--text-tertiary)]">{t('planning_page.estimated_cost', 'Estimated cost')}</p><strong className="text-2xl">{allocation?.total_estimated_cost ?? '—'}</strong></article>
                <article className="rounded border bg-[var(--bg-primary)] p-4"><AlertTriangle size={18} /><p className="mt-2 text-sm text-[var(--text-tertiary)]">{t('planning_page.warnings', 'Warnings')}</p><strong className="text-2xl">{diagnostics.length + (allocation?.warnings?.length || 0)}</strong></article>
            </section>
            <section className="rounded border bg-[var(--bg-primary)] p-4"><h2 className="mb-3 text-lg font-medium">{t('planning_page.schedule', 'Schedule')}</h2>{loading ? <p>{t('common.loading', 'Loading...')}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">{t('planning_page.task', 'Task')}</th><th className="p-2">{t('planning_page.start', 'Start')}</th><th className="p-2">{t('planning_page.finish', 'Finish')}</th><th className="p-2">{t('planning_page.slack', 'Slack')}</th></tr></thead><tbody>{tasks.map((task) => <tr className="border-b" key={task.id}><td className={task.critical ? 'p-2 font-semibold text-red-600' : 'p-2'}>{task.title}</td><td className="p-2">{task.start}</td><td className="p-2">{task.end}</td><td className="p-2">{task.freeSlackMinutes}</td></tr>)}</tbody></table></div>}</section>
            {tasks.length > 0 && <section className="h-[620px] overflow-hidden rounded border bg-[var(--bg-primary)]"><VaultTimeline notes={ganttNotes} schema={{ Schedule: 'period' }} activeView={{ dateField: 'Schedule', endDateField: 'Schedule' }} idToTitle={Object.fromEntries(tasks.map((task) => [task.id, task.title]))} /></section>}
            {diagnostics.length > 0 && <section className="rounded border bg-[var(--bg-primary)] p-4"><h2 className="mb-2 text-lg font-medium">{t('planning_page.diagnostics', 'Diagnostics')}</h2><ul className="space-y-1 text-sm">{diagnostics.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}</ul></section>}
        </main>
    );
}
