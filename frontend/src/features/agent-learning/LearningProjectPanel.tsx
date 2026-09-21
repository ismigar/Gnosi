import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    bindLearningProject, fetchLearningWorkspace, saveLearningProject,
    removeLearningProject, type LearningWorkspace, type LearningProject, type ProjectDraft,
} from '../../shared/api/agent-learning';
import type { ChatStreamRequest } from '../../shared/api/chat-streaming';
import ConfirmModal from '../../shared/ui/dialogs/ConfirmModal';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';

type ContextRefs = NonNullable<ChatStreamRequest['context_refs']>;
interface Props {
    readonly agentId: string;
    readonly sessionId: string;
    readonly contextRefs: Readonly<ContextRefs>;
    readonly lastResult?: string;
}

export function LearningProjectPanel({ agentId, sessionId, contextRefs, lastResult = '' }: Props) {
    const { t } = useTranslation();
    const [workspace, setWorkspace] = useState<LearningWorkspace>({ projects: [], project_id: '' });
    const [editing, setEditing] = useState<LearningProject | 'new' | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const selected = workspace.projects.find(project => project.id === workspace.project_id);
    const reload = useCallback(async (signal?: AbortSignal) => {
        try {
            const value = await fetchLearningWorkspace(agentId, sessionId, signal);
            if (!signal?.aborted) { setWorkspace(value); setError(''); }
        } catch { if (!signal?.aborted) setError(t('learning.load_error')); }
    }, [agentId, sessionId, t]);
    useEffect(() => {
        const controller = new AbortController();
        queueMicrotask(() => { if (!controller.signal.aborted) void reload(controller.signal); });
        return () => { controller.abort(); };
    }, [reload]);
    const mutate = async (action: () => Promise<unknown>) => {
        if (busy) return;
        setBusy(true); setError('');
        try { await action(); setEditing(null); setDeleting(false); await reload(); }
        catch { setError(t('learning.save_error')); }
        finally { setBusy(false); }
    };
    return <section className="agent-learning">
        <div className="agent-learning__toolbar">
        <label>{t('learning.project')}<select className="gnosi-select" value={workspace.project_id || ''} disabled={busy} onChange={event => {
            const id = event.target.value;
            void mutate(() => bindLearningProject(agentId, sessionId, id));
        }}>
            <option value="">{t('learning.no_project')}</option>
            {workspace.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>
        <RefreshButton onClick={() => { void reload(); }} disabled={busy} />
        </div>
        <p className="agent-learning__muted">{t('learning.project_help')}</p>
        <div className="agent-learning__actions">
            <button className="btn-gnosi btn-gnosi-secondary" disabled={busy} type="button" onClick={() => { setEditing('new'); }}>{t('learning.new_project')}</button>
            {selected && <button className="btn-gnosi btn-gnosi-secondary" disabled={busy} type="button" onClick={() => { setEditing(selected); }}>{t('common.edit')}</button>}
            {selected && <button className="btn-gnosi btn-gnosi-secondary" disabled={busy} type="button" onClick={() => { setDeleting(true); }}>{t('common.delete')}</button>}
        </div>
        {error && <p role="alert" className="agent-learning__error">{error}</p>}
        {selected && !editing && <div className="agent-learning__card">
            <strong>{selected.name}</strong>
            <pre>{selected.instructions}</pre>
            <strong>{t('learning.sources')}</strong>
            <ul>{selected.context_refs?.map(source => <li key={source.id}>{source.label || source.ref}</li>)}</ul>
            <strong>{t('learning.results')}</strong>
            <ul>{selected.results?.map((result, index) => <li key={index}><pre>{result}</pre></li>)}</ul>
        </div>}
        {editing && <ProjectEditor key={editing === 'new' ? 'new' : editing.id} project={editing === 'new' ? undefined : editing} contextRefs={contextRefs} lastResult={lastResult} busy={busy} onCancel={() => { setEditing(null); }} onSave={draft => mutate(async () => {
            const project = await saveLearningProject(agentId, draft, editing === 'new' ? '' : editing.id);
            await bindLearningProject(agentId, sessionId, project.id);
        })} />}
        <ConfirmModal isOpen={deleting} title={t('learning.delete_project')} message={t('learning.delete_project_help')} onClose={() => { if (!busy) setDeleting(false); }} onConfirm={() => selected && mutate(() => removeLearningProject(agentId, selected.id))} confirmOnEnter={false} />
    </section>;
}

function ProjectEditor({ project, contextRefs, lastResult, busy, onSave, onCancel }: {
    readonly project?: LearningProject; readonly contextRefs: Readonly<ContextRefs>; readonly lastResult: string;
    readonly busy: boolean; readonly onSave: (draft: ProjectDraft) => Promise<void>; readonly onCancel: () => void;
}) {
    const { t } = useTranslation();
    const [name, setName] = useState(project?.name || '');
    const [instructions, setInstructions] = useState(project?.instructions || '');
    const [sources, setSources] = useState<ContextRefs>(project?.context_refs || []);
    const [results, setResults] = useState((project?.results || []).join('\n'));
    return <form className="agent-learning__card" onSubmit={event => { event.preventDefault(); if (!busy && name.trim()) void onSave({
        name, instructions, context_refs: sources, results: results.split('\n').map(value => value.trim()).filter(Boolean),
        ...(project ? { expected_revision: project.revision } : {}),
    }); }}>
        <label>{t('learning.name')}<input className="gnosi-input" value={name} maxLength={160} required onChange={event => { setName(event.target.value); }} /></label>
        <label>{t('learning.project_instructions')}<textarea className="gnosi-input" value={instructions} maxLength={8000} rows={4} onChange={event => { setInstructions(event.target.value); }} /></label>
        <strong>{t('learning.sources')}</strong>
        <ul>{sources.map(source => <li key={source.id}>{source.label || source.ref} <button className="btn-gnosi btn-gnosi-secondary" type="button" onClick={() => { setSources(current => current.filter(item => item.id !== source.id)); }}>{t('common.remove')}</button></li>)}</ul>
        <button className="btn-gnosi btn-gnosi-secondary" type="button" disabled={!contextRefs.length} onClick={() => {
            setSources(current => [...new Map([...current, ...contextRefs.filter(item => item.type !== 'notebook')].map(item => [item.id, item])).values()].slice(0, 16));
        }}>{t('learning.add_current_sources')}</button>
        <label>{t('learning.results')}<textarea className="gnosi-input" rows={3} value={results} onChange={event => { setResults(event.target.value); }} /></label>
        <p className="agent-learning__muted">{t('learning.results_help')}</p>
        {lastResult && <button className="btn-gnosi btn-gnosi-secondary" type="button" onClick={() => { setResults(current => [current, lastResult.replace(/\s+/gu, ' ').slice(0, 2000)].filter(Boolean).join('\n')); }}>{t('learning.add_result')}</button>}
        <div className="agent-learning__actions">
            <button className="btn-gnosi btn-gnosi-secondary" type="button" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
            <button className="btn-gnosi btn-gnosi-primary" type="submit" disabled={busy || !name.trim()}>{t('common.save')}</button>
        </div>
    </form>;
}
