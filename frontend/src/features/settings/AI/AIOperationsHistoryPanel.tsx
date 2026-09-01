import { useMemo, useState } from 'react';
import { Check, Clock3, Loader2, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../../shared/notifications/notifyError';
import { toast } from '../../../shared/notifications/toast';
import { operationStatusLabel, toolDisplayName } from './aiResourceI18n';


type ApprovalDecision = 'cancel' | 'confirm';


interface OperationTool extends Record<string, unknown> {
    id: string;
    name?: string;
}


interface AutomationApproval {
    agent_id: string;
    confirmation_id: string;
    details?: { tool?: string | null } | null;
    session_id: string;
}


interface AutomationJob {
    job_id: string;
    provider?: string | null;
    status?: string | null;
}


interface AutomationAuditEvent {
    agent_id: string;
    created_at: number;
    duration_ms: number;
    id: string;
    status?: string | null;
    tool_name: string;
}


interface OperationsHistoryResources {
    approvals: readonly AutomationApproval[];
    auditEvents: readonly AutomationAuditEvent[];
    jobs: readonly AutomationJob[];
    resolveApproval: (
        approval: AutomationApproval,
        decision: ApprovalDecision,
    ) => Promise<unknown>;
    tools?: readonly OperationTool[];
}


interface OperationsHistoryPanelProps {
    readonly resources: OperationsHistoryResources;
}


const findCatalogTool = (
    tools: readonly OperationTool[] = [],
    value: string | null | undefined,
): OperationTool | undefined => {
    const normalized = (value ?? '').replaceAll('_', '-');
    return tools.find((tool) => (
        tool.id === value
        || tool.id.endsWith(`.${normalized}`)
        || tool.id.endsWith(`-${normalized}`)
    ));
};


export const OperationsHistoryPanel = ({
    resources,
}: OperationsHistoryPanelProps) => {
    const { t, i18n } = useTranslation();
    const [resolvingId, setResolvingId] = useState('');
    const events = useMemo(
        () => resources.auditEvents.slice(0, 200),
        [resources.auditEvents],
    );

    const resolve = async (
        approval: AutomationApproval,
        decision: ApprovalDecision,
    ): Promise<void> => {
        setResolvingId(approval.confirmation_id);
        try {
            await resources.resolveApproval(approval, decision);
            toast.success(t(`settings.ai.operations.approval_${decision}ed`));
        } catch (error) {
            logError('ai-automation-approval', error);
            toast.error(t('settings.ai.operations.approval_error'));
        } finally {
            setResolvingId('');
        }
    };

    return (
        <div className="ai-resources-panel">
            <h4>{t('settings.ai.operations.approvals_title')}</h4>
            <div className="ai-resource-list">
                {resources.approvals.map((approval) => {
                    const catalogTool = findCatalogTool(
                        resources.tools,
                        approval.details?.tool,
                    );
                    return (
                        <article
                            key={approval.confirmation_id}
                            className="ai-resource-card"
                        >
                            <div className="ai-resource-card__main">
                                <ShieldCheck size={18} />
                                <span className="ai-resource-card__copy">
                                    <span className="ai-resource-card__heading">
                                        <strong>{t('settings.ai.operations.approval_requested')}</strong>
                                        <code>{approval.agent_id}</code>
                                    </span>
                                    <span>
                                        {catalogTool
                                            ? toolDisplayName(t, catalogTool)
                                            : t('settings.ai.operations.approval_summary')}
                                    </span>
                                </span>
                            </div>
                            <div className="ai-resource-card__actions">
                                <button
                                    type="button"
                                    onClick={() => {
                                        void resolve(approval, 'confirm');
                                    }}
                                    disabled={resolvingId === approval.confirmation_id}
                                >
                                    {resolvingId === approval.confirmation_id
                                        ? <Loader2 size={15} className="animate-spin" />
                                        : <Check size={15} />}{' '}
                                    {t('settings.ai.operations.approve')}
                                </button>
                                <button
                                    type="button"
                                    className="is-danger"
                                    onClick={() => {
                                        void resolve(approval, 'cancel');
                                    }}
                                    disabled={resolvingId === approval.confirmation_id}
                                >
                                    <X size={15} />
                                    {t('settings.ai.operations.reject')}
                                </button>
                            </div>
                        </article>
                    );
                })}
                {resources.approvals.length === 0 && (
                    <span className="ai-resource-muted">
                        {t('settings.ai.operations.no_approvals')}
                    </span>
                )}
            </div>

            <h4>{t('settings.ai.operations.jobs_title')}</h4>
            <div className="ai-resource-list">
                {resources.jobs.map((job) => (
                    <article key={job.job_id} className="ai-resource-card">
                        <div className="ai-resource-card__main">
                            <Clock3 size={18} />
                            <span className="ai-resource-card__copy">
                                <span className="ai-resource-card__heading">
                                    <strong>{job.job_id}</strong>
                                    <code>{job.provider}</code>
                                </span>
                                <span>{operationStatusLabel(t, job.status)}</span>
                            </span>
                        </div>
                    </article>
                ))}
                {resources.jobs.length === 0 && (
                    <span className="ai-resource-muted">
                        {t('settings.ai.operations.no_jobs')}
                    </span>
                )}
            </div>

            <h4>{t('settings.ai.operations.audit_title')}</h4>
            <div className="ai-resource-list">
                {events.map((event) => {
                    const catalogTool = findCatalogTool(
                        resources.tools,
                        event.tool_name,
                    );
                    return (
                        <article key={event.id} className="ai-resource-card">
                            <div className="ai-resource-card__main">
                                <span className="ai-resource-card__copy">
                                    <span className="ai-resource-card__heading">
                                        <strong>
                                            {catalogTool
                                                ? toolDisplayName(t, catalogTool)
                                                : t('settings.ai.operations.capability_event')}
                                        </strong>
                                        <code>{operationStatusLabel(t, event.status)}</code>
                                    </span>
                                    <span className="ai-resource-card__meta">
                                        <span>{event.agent_id}</span>
                                        <code>{event.tool_name}</code>
                                        <span>{t('settings.ai.operations.duration_ms', {
                                            count: event.duration_ms,
                                        })}</span>
                                        <span>{new Date(
                                            event.created_at * 1000,
                                        ).toLocaleString(
                                            i18n.resolvedLanguage || i18n.language || 'en',
                                        )}</span>
                                    </span>
                                </span>
                            </div>
                        </article>
                    );
                })}
                {events.length === 0 && (
                    <span className="ai-resource-muted">
                        {t('settings.ai.operations.no_audit')}
                    </span>
                )}
            </div>
        </div>
    );
};
