import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { agentTraceRetention } from '../../../shared/api/ai-activity';
import { useActiveVaultId } from '../../../shared/hooks/useActiveVaultId';

export function AgentTraceRetention() {
    const { t } = useTranslation();
    const vault = useActiveVaultId();
    const [days, setDays] = useState(30);
    const [error, setError] = useState('');
    const [pending, setPending] = useState(false);
    useEffect(() => {
        let active = true;
        void agentTraceRetention().then(value => { if (active) setDays(value); }).catch((failure: unknown) => { if (active) setError(String(failure)); });
        return () => { active = false; };
    }, [vault]);
    const save = async () => {
        setPending(true);
        try { setDays(await agentTraceRetention(days)); setError(''); }
        catch (failure) { setError(String(failure)); }
        finally { setPending(false); }
    };
    return <div className="flex flex-wrap gap-2">
        <label>{t('agent_behavior.retention')} <input className="gnosi-input" type="number" min={1} max={3650} value={days} onChange={event => { setDays(Number(event.target.value)); }} /></label>
        <button className="btn-gnosi-secondary" disabled={pending || !Number.isInteger(days) || days < 1 || days > 3650} onClick={() => { void save(); }}>{t('common.save')}</button>
        {error && <p role="alert">{error}</p>}
    </div>;
}
