import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchAgentTrace, exportAgentTrace, deleteAgentTrace, type AgentTracePage } from '../../../shared/api/ai-activity';

export function AgentTraceDetails({ runId, canDelete = false, state = 'available' }: { runId: string; canDelete?: boolean; state?: string }) {
    const { t } = useTranslation();
    const [events, setEvents] = useState<AgentTracePage['events']>([]);
    const [cursor, setCursor] = useState(0);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [more, setMore] = useState(true);
    const [deleted, setDeleted] = useState(false);
    const act = async (action: 'export' | 'delete') => {
        setPending(true);
        try {
            if (action === 'delete') {
                await deleteAgentTrace(runId); setEvents([]); setDeleted(true); setMore(false);
            } else {
                const url = URL.createObjectURL(await exportAgentTrace(runId));
                const link = document.createElement('a'); link.href = url; link.download = `agent-trace-${runId}.json`; link.click();
                setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
            }
            setError('');
        } catch (failure) { setError(String(failure)); }
        finally { setPending(false); }
    };
    const load = async () => {
        setPending(true);
        try {
            const page = await fetchAgentTrace(runId, cursor);
            setEvents(previous => [...previous, ...page.events]);
            setCursor(page.next_cursor); setLoaded(true); setMore(page.events.length === 100); setError('');
        } catch (failure) { setError(String(failure)); }
        finally { setPending(false); }
    };
    return <details className="ai-resource-details" onToggle={event => { if (event.currentTarget.open && !loaded && !pending) void load(); }}>
        <summary>{t('agent_behavior.trace')}</summary>
        {(deleted || state !== 'available') && <p role="status">{t(`agent_behavior.trace_${deleted ? 'deleted' : state}`)}</p>}
        {error && <p role="alert">{error}</p>}
        {!deleted && state === 'available' && <div className="flex flex-wrap gap-2">
            <button className="btn-gnosi-secondary" disabled={pending} onClick={() => { void act('export'); }}>{t('agent_behavior.export')}</button>
            {canDelete && <button className="btn-gnosi-secondary" disabled={pending} onClick={() => { void act('delete'); }}>{t('agent_behavior.delete')}</button>}
        </div>}
        {events.map(event => <details key={event.id}><summary>{event.kind}</summary><pre className="whitespace-pre-wrap">{JSON.stringify(event.value, null, 2)}</pre></details>)}
        {loaded && more && <button className="btn-gnosi-secondary" disabled={pending} onClick={() => { void load(); }}>{t('agent_behavior.more')}</button>}
    </details>;
}
