import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bindAgentOperation, previewAgentBehavior, type BehaviorPreview } from '../../../shared/api/ai-activity';
import { useActiveVaultId } from '../../../shared/hooks/useActiveVaultId';

export function AgentBehaviorInspection({ profile, operationsOnly = false }: { profile: Record<string, unknown>; operationsOnly?: boolean }) {
    const { t } = useTranslation();
    const vaultId = useActiveVaultId();
    const [value, setValue] = useState<BehaviorPreview>();
    const [error, setError] = useState('');
    const [pending, setPending] = useState(false);
    const [revision, setRevision] = useState(0);
    const serialized = JSON.stringify(profile);
    useEffect(() => {
        const controller = new AbortController();
        setValue(undefined);
        void previewAgentBehavior(JSON.parse(serialized) as Record<string, unknown>, controller.signal)
            .then(result => { if (!controller.signal.aborted) { setValue(result); setError(''); } })
            .catch((failure: unknown) => { if (!controller.signal.aborted) setError(String(failure)); });
        return () => { controller.abort(); };
    }, [serialized, vaultId, revision]);
    if (error) return <p role="alert">{error}</p>;
    if (!value) return <p role="status">{t('common.loading')}</p>;
    return <div className="ai-resource-list">
        <p>{t('agent_behavior.preview_help')}</p>
        {operationsOnly ? value.operations.map(operation => <article className="ai-resource-card" key={operation.operation}>
            <strong>{t(`agent_execution.skills.${operation.operation}`, { defaultValue: operation.name })}</strong>
            <p>{operation.skill_id}</p>
            <p>{t('agent_behavior.executor')}: {operation.agent_id}</p>
            {typeof profile.id === 'string' && operation.agent_id !== profile.id && <button type="button" className="btn-gnosi-secondary" disabled={pending} onClick={() => {
                setPending(true);
                void bindAgentOperation(String(operation.operation), String(profile.id), String(operation.agent_id))
                    .then(() => { setRevision(value => value + 1); })
                    .catch((failure: unknown) => { setError(String(failure)); })
                    .finally(() => { setPending(false); });
            }}>{t('agent_behavior.assign_operation')}</button>}
        </article>) : <>
            <section><h4>{t('agent_behavior.instructions')}</h4><pre className="whitespace-pre-wrap">{value.instructions}</pre></section>
            <section><h4>{t('agent_behavior.context')}</h4><pre className="whitespace-pre-wrap">{value.context}</pre></section>
            <section><h4>{t('agent_behavior.skills')}</h4>{value.skills.map(skill => <details className="ai-resource-details" key={String(skill.id)}>
                <summary>{String(skill.name)} · {String(skill.version)}</summary>
                <p>{String(skill.effective_id)} · {String(skill.revision)}</p>
                <pre className="whitespace-pre-wrap">{String(skill.instructions)}</pre>
            </details>)}</section>
            <details className="ai-resource-details"><summary>{t('agent_behavior.system')}</summary><pre className="whitespace-pre-wrap">{value.system}</pre>
                {value.system_resources.map(resource => <details key={resource.path}><summary>{resource.path}</summary><pre className="whitespace-pre-wrap">{resource.text}</pre></details>)}
            </details>
            {value.missing_skill_ids.length > 0 && <p role="alert">{t('agent_behavior.missing')}: {value.missing_skill_ids.join(', ')}</p>}
        </>}
    </div>;
}
