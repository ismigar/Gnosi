import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { fetchConfiguration } from '../../api/configuration';
import { useActiveVaultId } from '../../hooks/useActiveVaultId';

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const operationPlugins: Readonly<Record<string, string>> = {
    writing: 'ai-platform', tables: 'ai-platform', capture: 'ai-platform', learning: 'ai-platform',
    reader: 'feeds-reader', podcast: 'feeds-reader', notebook: 'grounded-notebooks',
    literature: 'resources', mail: 'mail', social: 'social-publishing', meeting: 'calendar',
    translation: 'translation', knowledge: 'llm-wiki',
};

/** Show the profile that actually executes this feature. */
export function PrincipalAgentReference({ operation, profileId }: { readonly operation: string; readonly profileId?: string }) {
    const { t } = useTranslation();
    const vaultId = useActiveVaultId();
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        void fetchConfiguration().then(config => {
            if (!active) return;
            const ai = config.ai;
            if (!isRecord(ai)) return;
            const profiles: unknown[] = Array.isArray(ai.agents) ? ai.agents : [];
            const plugin = operationPlugins[operation];
            const principal = profiles.find(profile => isRecord(profile) && (profileId
                ? profile.id === profileId
                : plugin ? profile.managed_by === `builtin:${plugin}` : profile.id === ai.active_agent_id));
            setName(isRecord(principal) ? (typeof principal.name === 'string' ? principal.name : typeof principal.id === 'string' ? principal.id : '') : '');
        }).catch((failure: unknown) => { if (active) setError(String(failure)); });
        return () => { active = false; };
    }, [vaultId, operation, profileId]);
    return <div className="settings-desc">
        <p>{t('agent_execution.principal')}: {name || '—'}</p>
        <p>{t(`agent_execution.skills.${operation}`)}</p>
        {error && <p role="alert">{error}</p>}
        <Link className="btn-gnosi-secondary" to="/settings?tab=ai">{t('agent_execution.configure')}</Link>
    </div>;
}
