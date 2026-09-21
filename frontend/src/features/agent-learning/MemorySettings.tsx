import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    fetchAgentMemories, fetchLearningWorkspace, removeAgentMemory, saveAgentMemory,
    type AgentMemory, type LearningProject, type MemoryDraft,
} from '../../shared/api/agent-learning';
import { useActiveVaultId } from '../../shared/hooks/useActiveVaultId';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import { GnosiToggle } from '../../shared/ui/settings/SettingsPrimitives';
import ConfirmModal from '../../shared/ui/dialogs/ConfirmModal';
import { MemoryEditor, type NamedOption } from './MemoryEditor';
import './learning.css';

interface Props {
    readonly agents: readonly NamedOption[];
    readonly skills: readonly NamedOption[];
    readonly principalAgentId?: string;
    readonly canEdit?: boolean;
}

export function MemorySettings({ agents, skills, principalAgentId = '', canEdit = true }: Props) {
    const { t } = useTranslation();
    const vaultId = useActiveVaultId();
    const [choice, setChoice] = useState('');
    const agentId = agents.some(agent => agent.id === choice) ? choice
        : agents.find(agent => agent.id === principalAgentId)?.id || agents[0]?.id || '';
    return <div className="agent-learning">
        <p className="agent-learning__muted">{t('learning.memory_help')}</p>
        <label>{t('learning.assistant')}<select className="gnosi-select" value={agentId} onChange={event => { setChoice(event.target.value); }}>
            {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>)}
        </select></label>
        {agentId ? <MemoryList key={`${vaultId}:${agentId}`} agentId={agentId} skills={skills} canEdit={canEdit} /> : <p>{t('learning.no_assistant')}</p>}
    </div>;
}

export function MemoryList({ agentId, skills, canEdit }: { readonly agentId: string; readonly skills: readonly NamedOption[]; readonly canEdit: boolean }) {
    const { t, i18n } = useTranslation();
    const [memories, setMemories] = useState<AgentMemory[]>([]);
    const [projects, setProjects] = useState<LearningProject[]>([]);
    const [editing, setEditing] = useState<AgentMemory | 'new' | null>(null);
    const [deleting, setDeleting] = useState<AgentMemory | null>(null);
    const [search, setSearch] = useState('');
    const [scope, setScope] = useState('all');
    const [status, setStatus] = useState('all');
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = window.setInterval(() => { setNow(Date.now()); }, 60_000);
        return () => { window.clearInterval(timer); };
    }, []);
    const reload = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        try {
            const [memoryPage, workspace] = await Promise.all([fetchAgentMemories(agentId, signal), fetchLearningWorkspace(agentId, '', signal)]);
            if (signal?.aborted) return;
            setMemories(memoryPage.memories); setProjects(workspace.projects); setError('');
        } catch {
            if (!signal?.aborted) setError(t('learning.load_error'));
        } finally { if (!signal?.aborted) setLoading(false); }
    }, [agentId, t]);
    useEffect(() => {
        const controller = new AbortController();
        queueMicrotask(() => { if (!controller.signal.aborted) void reload(controller.signal); });
        return () => { controller.abort(); };
    }, [reload]);
    const mutate = async (operation: () => Promise<unknown>) => {
        if (busy) return;
        setBusy(true); setError('');
        try { await operation(); setEditing(null); setDeleting(null); await reload(); }
        catch { setError(t('learning.save_error')); }
        finally { setBusy(false); }
    };
    const save = async (draft: MemoryDraft) => {
        await mutate(() => saveAgentMemory(agentId, draft, editing && editing !== 'new' ? editing.memory_id : ''));
    };
    const expired = (memory: AgentMemory) => Boolean(memory.expires_at && Date.parse(memory.expires_at) <= now);
    const filtered = memories.filter(memory =>
        (scope === 'all' || memory.scope_kind === scope)
        && (status === 'all' || (status === 'active' ? memory.enabled && !expired(memory) : !memory.enabled || expired(memory)))
        && memory.text.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()));
    return <div className="agent-learning" aria-busy={busy || loading}>
        <div className="agent-learning__toolbar">
            <input className="gnosi-input" aria-label={t('learning.search_memory')} placeholder={t('learning.search_memory')} value={search} onChange={event => { setSearch(event.target.value); }} />
            {canEdit && <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={busy} onClick={() => { setEditing('new'); }}><Plus size={16} />{t('common.add')}</button>}
            <RefreshButton onClick={() => { void reload(); }} disabled={busy || loading} />
        </div>
        <div className="agent-learning__filters">
            <label>{t('learning.scope')}<select className="gnosi-select" value={scope} onChange={event => { setScope(event.target.value); }}>
                <option value="all">{t('learning.all')}</option>
                {['personal', 'project', 'skill'].map(value => <option key={value} value={value}>{t(`learning.scopes.${value}`)}</option>)}
            </select></label>
            <label>{t('learning.status')}<select className="gnosi-select" value={status} onChange={event => { setStatus(event.target.value); }}>
                {['all', 'active', 'inactive'].map(value => <option key={value} value={value}>{t(`learning.${value}`)}</option>)}
            </select></label>
        </div>
        {error && <p role="alert" className="agent-learning__error">{error}</p>}
        {!canEdit && <p>{t('learning.read_only')}</p>}
        {editing && <MemoryEditor key={editing === 'new' ? 'new' : editing.memory_id} memory={editing === 'new' ? undefined : editing} projects={projects} skills={skills} busy={busy} onSave={save} onCancel={() => { setEditing(null); }} />}
        {loading && <p role="status">{t('common.loading')}</p>}
        {!loading && !error && !filtered.length && <p>{t(memories.length ? 'learning.no_matches' : 'learning.no_memories')}</p>}
        {filtered.map(memory => <article className="agent-learning__card" key={memory.memory_id}>
            <pre>{memory.text}</pre>
            <div className="agent-learning__meta">
                <span>{t(`learning.scopes.${memory.scope_kind || 'personal'}`)}</span>
                {memory.scope_id && <span>{[...projects, ...skills].find(item => item.id === memory.scope_id)?.name || t('learning.unavailable_scope')}</span>}
                <span>{t(memory.provenance === 'conversation' ? 'learning.from_conversation' : 'learning.from_user')}</span>
                <time dateTime={memory.updated_at}>{new Date(memory.updated_at).toLocaleString(i18n.language)}</time>
                {memory.expires_at && <span>{t(expired(memory) ? 'learning.expired' : 'learning.expires', { date: new Date(memory.expires_at).toLocaleString(i18n.language) })}</span>}
            </div>
            {canEdit && <div className="agent-learning__actions">
                <GnosiToggle active={memory.enabled} label={t('learning.enable_memory', { text: memory.text })} disabled={busy} onChange={() => { void mutate(() => saveAgentMemory(agentId, {
                    text: memory.text, category: memory.category, enabled: !memory.enabled, scope_kind: memory.scope_kind, scope_id: memory.scope_id,
                    provenance: memory.provenance, expires_at: memory.expires_at, expected_revision: memory.revision,
                }, memory.memory_id)); }} />
                <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={busy} onClick={() => { setEditing(memory); }}>{t('common.edit')}</button>
                <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={busy} onClick={() => { setDeleting(memory); }}>{t('common.delete')}</button>
            </div>}
        </article>)}
        <ConfirmModal isOpen={Boolean(deleting)} title={t('learning.delete_memory')} message={deleting?.text} onClose={() => { if (!busy) setDeleting(null); }} onConfirm={() => deleting && mutate(() => removeAgentMemory(agentId, deleting.memory_id))} confirmOnEnter={false} />
    </div>;
}
