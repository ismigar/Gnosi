import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { removeAgentMemory, saveAgentMemory } from '../../../shared/api/agent-learning';
import { boundedMemoryProvenance } from './memoryProvenance';

export function MemorySources({ value, readOnly }: { value: unknown; readOnly: boolean }) {
  const { t } = useTranslation();
  const sources = boundedMemoryProvenance(value);
  const [editing, setEditing] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [changed, setChanged] = useState<string[]>([]);
  if (!sources.length) return null;
  const mutate = async (source: typeof sources[number], forget: boolean) => {
    if (busy) return;
    setBusy(true); setStatus('');
    try {
      if (forget) await removeAgentMemory(source.agent_id, source.memory_id);
      else await saveAgentMemory(source.agent_id, { text: draft, category: source.category, scope_kind: source.scope_kind, scope_id: source.scope_id, expected_revision: source.revision, enabled: source.enabled, expires_at: source.expires_at, provenance: 'user' }, source.memory_id);
      setChanged(previous => [...previous, source.memory_id]); setEditing(''); setStatus(t('chat.memory.updated', 'Memory updated. This response keeps the historical source.'));
    } catch { setStatus(t('chat.memory.error', 'Could not update this memory. It may have changed; open memory settings to review it.')); }
    finally { setBusy(false); }
  };
  return <details style={{ marginTop: 8, whiteSpace: 'normal' }}><summary>{t('chat.memory.sources', 'Memories selected for this response')} ({sources.length})</summary>
    {sources.map(source => <div key={source.memory_id} style={{ marginTop: 6 }}><p>{source.text}</p><small>{source.scope_kind}{source.scope_id ? ` · ${source.scope_id}` : ''}</small>
      {!readOnly && !changed.includes(source.memory_id) && <div>{editing === source.memory_id ? <><textarea value={draft} onChange={event => { setDraft(event.target.value); }} aria-label={t('chat.memory.correct', 'Correct memory')} /><button className="btn-gnosi btn-gnosi-secondary" disabled={busy || !draft.trim()} type="button" onClick={() => { void mutate(source, false); }}>{t('common.save', 'Save')}</button><button type="button" onClick={() => { setEditing(''); }}>{t('common.cancel', 'Cancel')}</button></> : <button className="btn-gnosi btn-gnosi-secondary" type="button" disabled={busy} onClick={() => { setEditing(source.memory_id); setDraft(source.text); }}>{t('chat.memory.correct', 'Correct memory')}</button>}
      <button className="btn-gnosi btn-gnosi-secondary" disabled={busy} type="button" onClick={() => { void mutate(source, true); }}>{t('chat.memory.forget', 'Forget memory')}</button></div>}
    </div>)}<p role="status">{status}</p></details>;
}
