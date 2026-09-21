import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GnosiToggle } from '../../shared/ui/settings/SettingsPrimitives';
import type { AgentMemory, LearningProject, MemoryDraft } from '../../shared/api/agent-learning';

export interface NamedOption { readonly id: string; readonly name?: string }

interface Props {
    readonly memory?: AgentMemory;
    readonly projects: readonly LearningProject[];
    readonly skills: readonly NamedOption[];
    readonly busy: boolean;
    readonly onSave: (draft: MemoryDraft) => Promise<void>;
    readonly onCancel: () => void;
}

function localDate(value?: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function MemoryEditor({ memory, projects, skills, busy, onSave, onCancel }: Props) {
    const { t } = useTranslation();
    const [text, setText] = useState(memory?.text || '');
    const [scope, setScope] = useState(memory?.scope_kind || 'personal');
    const [scopeId, setScopeId] = useState(memory?.scope_id || '');
    const [category, setCategory] = useState(memory?.category || 'preference');
    const [enabled, setEnabled] = useState(memory?.enabled ?? true);
    const [expiry, setExpiry] = useState(localDate(memory?.expires_at));
    const options = scope === 'project' ? projects : skills;
    return <form className="agent-learning__card" onSubmit={event => {
        event.preventDefault();
        if (busy || !text.trim() || (scope !== 'personal' && !scopeId)) return;
        void onSave({
            text, category, enabled, scope_kind: scope, scope_id: scope === 'personal' ? '' : scopeId,
            provenance: memory?.provenance || 'user',
            expires_at: expiry ? new Date(expiry).toISOString() : null,
            ...(memory ? { expected_revision: memory.revision } : {}),
        });
    }}>
        <label>{t('learning.memory_text')}<textarea className="gnosi-input" rows={4} maxLength={4000} value={text} onChange={event => { setText(event.target.value); }} required /></label>
        <div className="agent-learning__filters">
            <label>{t('learning.category')}<select className="gnosi-select" value={category} onChange={event => { setCategory(event.target.value); }}>
                {!['preference', 'fact', 'decision', 'procedure'].includes(category) && <option value={category}>{category}</option>}
                {['preference', 'fact', 'decision', 'procedure'].map(value => <option key={value} value={value}>{t(`learning.categories.${value}`)}</option>)}
            </select></label>
            <label>{t('learning.scope')}<select className="gnosi-select" value={scope} onChange={event => { setScope(event.target.value); setScopeId(''); }}>
                {['personal', 'project', 'skill'].map(value => <option key={value} value={value}>{t(`learning.scopes.${value}`)}</option>)}
            </select></label>
        </div>
        {scope !== 'personal' && <label>{t(scope === 'project' ? 'learning.project' : 'learning.skill')}<select className="gnosi-select" value={scopeId} onChange={event => { setScopeId(event.target.value); }} required>
            <option value="">{t('learning.select_scope')}</option>
            {scopeId && !options.some(item => item.id === scopeId) && <option value={scopeId}>{t('learning.unavailable_scope')}</option>}
            {options.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
        </select></label>}
        <label>{t('learning.expiry')}<input className="gnosi-input" type="datetime-local" value={expiry} onChange={event => { setExpiry(event.target.value); }} /></label>
        <div className="agent-learning__toggle">
            <GnosiToggle label={t('learning.enabled')} active={enabled} onChange={() => { setEnabled(current => !current); }} />
            <span>{t('learning.enabled')}</span>
        </div>
        <div className="agent-learning__actions">
            <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
            <button type="submit" className="btn-gnosi btn-gnosi-primary" disabled={busy || !text.trim() || (scope !== 'personal' && !scopeId)}>{t('common.save')}</button>
        </div>
    </form>;
}
