import { useTranslation } from 'react-i18next';
import type { MessageDetailsData, MessageJobAction } from './messageDetailsModel';

interface Props {
  readonly msg: MessageDetailsData;
  readonly onJobAction: (action?: MessageJobAction) => void;
  readonly onFocusComposer: (value: string) => void;
}

export function MessageDetails({ msg, onJobAction, onFocusComposer }: Props) {
    const { t } = useTranslation();
    const budgets = msg.explanation?.budgets || msg.plan?.budgets;
    const jobId = msg.job?.job_id ?? '';
    return (
        <div style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', margin: '0 4px', padding: '6px 8px', borderRadius: '8px', background: 'var(--settings-sidebar-bg, #f3f4f6)', color: 'var(--text-secondary)', fontSize: '0.68rem' }}>
            {msg.llm?.model && <div>{t('chat.agent_model', 'Model: {{model}}', { model: msg.llm.model })}</div>}
            {msg.llm?.strategy?.mode && <div>{t('chat.agent_model_strategy', 'Strategy: {{strategy}}', {
                strategy: t(`settings.ai.model_strategy.${msg.llm.strategy.mode}`, msg.llm.strategy.mode),
            })}</div>}
            {msg.timings && (
                <>
                    <div>{t('chat.timing_total', 'Server total: {{count}} ms', { count: msg.timings.total_ms ?? 0 })}</div>
                    <div>{t('chat.timing_setup', 'Setup: {{count}} ms', { count: msg.timings.setup_ms ?? 0 })}</div>
                    <div>{t('chat.timing_routing', 'Routing: {{count}} ms', { count: msg.timings.routing_ms ?? 0 })}</div>
                    <div>{t('chat.timing_tools', 'Tools: {{count}} ms', { count: msg.timings.tools_ms ?? 0 })}</div>
                    <div>{t('chat.timing_model', 'Model: {{count}} ms', { count: msg.timings.model_ms ?? 0 })}</div>
                    <div>{t('chat.timing_misc', 'Other: {{count}} ms', { count: msg.timings.other_ms ?? 0 })}</div>
                    <div>{t('chat.timing_usage', '{{input}} input tokens · {{output}} output tokens · {{models}} model calls · {{tools}} tool calls', {
                        input: msg.timings.input_tokens ?? 0,
                        output: msg.timings.output_tokens ?? 0,
                        models: msg.timings.model_calls ?? 0,
                        tools: msg.timings.tool_calls ?? 0,
                    })}</div>
                    {msg.timings.estimated_cost_usd !== undefined && (
                        <div>{t('chat.timing_cost', 'Estimated cost: ${{amount}}', {
                            amount: (msg.timings.estimated_cost_usd || 0).toFixed(6),
                        })}</div>
                    )}
                </>
            )}
            {msg.explanation && (
                <div style={{ marginTop: '5px' }}>
                    <strong>{t('chat.explanation_title', 'How this response was produced')}</strong>
                    <div>{t('chat.explanation_plan', 'Mode: {{mode}} · Route: {{route}} · Execution: {{execution}}', {
                        mode: t(`chat.mode.${msg.explanation.mode}`, msg.explanation.mode),
                        route: t(`chat.route.${msg.explanation.route}`, msg.explanation.route),
                        execution: t(`chat.execution.${msg.explanation.execution}`, msg.explanation.execution),
                    })}</div>
                    <div>{t('chat.explanation_evidence', '{{count}} evidence item(s) · {{tools}} tool(s)', {
                        count: msg.explanation.evidence_count,
                        tools: msg.explanation.tools_used.length,
                    })}</div>
                    {(msg.explanation.budgets || (msg.plan && msg.plan.budgets)) && (
                        <div>{t('chat.explanation_budget', 'Budgets: {{models}} model calls · {{tools}} tool calls · {{seconds}} s', {
                            models: budgets?.max_model_calls ?? 0,
                            tools: budgets?.max_tool_calls ?? 0,
                            seconds: budgets?.timeout_seconds ?? 0,
                        })}</div>
                    )}
                </div>
            )}
            {msg.plan?.interpretation && (
                <div style={{ marginTop: '5px' }}>
                    <strong>{t('chat.interpretation_title', 'Request interpretation')}</strong>
                    <div>{t('chat.interpretation_summary', '{{operation}} · {{confidence}}% confidence', {
                        operation: t(`chat.mode.${msg.plan.interpretation.operation}`, msg.plan.interpretation.operation),
                        confidence: Math.round((msg.plan.interpretation.confidence || 0) * 100),
                    })}</div>
                    {msg.plan.interpretation.concepts.length > 0 && (
                        <div>{t('chat.interpretation_concepts', 'Concepts: {{concepts}}', {
                            concepts: msg.plan.interpretation.concepts.join(', '),
                        })}</div>
                    )}
                </div>
            )}
            {msg.plan?.capability_broker && (
                <div style={{ marginTop: '5px' }}>
                    <strong>{t('chat.capability_title', 'Selected capabilities')}</strong>
                    <div>{t('chat.capability_summary', '{{candidates}} candidate tools · {{guarded}} guarded tools', {
                        candidates: msg.plan.capability_broker.candidate_tools.length,
                        guarded: msg.plan.capability_broker.guarded_tools.length,
                    })}</div>
                    {msg.plan.capability_broker.discovery?.domains.map(item => (
                        <div key={item.domain}>{t('chat.capability_discovery_domain', '{{domain}}: {{status}}', {
                            domain: item.domain,
                            status: t(`chat.capability_discovery_status.${item.status}`, item.status),
                        })}</div>
                    ))}
                </div>
            )}
            {msg.plan?.deadline && (
                <div style={{ marginTop: '5px' }}>{t('chat.deadline_summary', 'Response window: synthesize after {{soft}} s · hard limit {{hard}} s', {
                    soft: msg.plan.deadline.soft_seconds,
                    hard: msg.plan.deadline.hard_seconds,
                })}</div>
            )}
            {msg.plan?.memory?.checkpointed && (
                <div style={{ marginTop: '5px' }}>{t('chat.memory_summary', 'Memory: session checkpoint (historical tool payloads excluded)')}</div>
            )}
            {msg.errorCode && (
                <div style={{ marginTop: '5px' }}>
                    <strong>{t('chat.recovery_title', 'Recovery')}</strong>
                    <div>{msg.retryable
                        ? t('chat.recovery_retryable', 'This error can be retried safely.')
                        : t('chat.recovery_edit_request', 'Edit the request and try again.')}</div>
                </div>
            )}
            {!msg.explanation && msg.plan?.budgets && (
                <div style={{ marginTop: '5px' }}>
                    <div>{t('chat.explanation_budget', 'Budgets: {{models}} model calls · {{tools}} tool calls · {{seconds}} s', {
                        models: msg.plan.budgets.max_model_calls,
                        tools: msg.plan.budgets.max_tool_calls,
                        seconds: msg.plan.budgets.timeout_seconds,
                    })}</div>
                </div>
            )}
            {msg.privacy && (
                <div style={{ marginTop: '5px' }}>
                    <strong>{t('chat.privacy_title', 'Privacy')}</strong>
                    <div>{t('chat.privacy_summary', '{{classification}} · {{count}} private source(s) · data minimized: {{minimized}}', {
                        classification: t(`chat.privacy_classification.${msg.privacy.classification}`, msg.privacy.classification),
                        count: msg.privacy.private_source_count,
                        minimized: msg.privacy.data_minimized ? t('common.yes', 'Yes') : t('common.no', 'No'),
                    })}</div>
                    {msg.privacy.private_evidence_to_remote_model && (
                        <div>{t('chat.privacy_remote_processing', 'Required private evidence may be processed by the configured remote model.')}</div>
                    )}
                </div>
            )}
            {msg.verification && (
                <div style={{ marginTop: '5px' }}>
                    <strong>{t('chat.verification_title', 'Verification')}</strong>
                    <div>{t('chat.verification_summary', '{{status}} · {{count}} evidence item(s)', {
                        status: t(`chat.verification_status.${msg.verification.status}`, msg.verification.status),
                        count: msg.verification.evidence_count,
                    })}</div>
                    {msg.verification.limitations.length > 0 && (
                        <div>{t('chat.verification_limitations', 'Limitations: {{limitations}}', {
                            limitations: msg.verification.limitations.map(value => t(`chat.verification_limitation.${value}`, value)).join(', '),
                        })}</div>
                    )}
                </div>
            )}
            {msg.quality && (
                <div style={{ marginTop: '5px' }}>
                    <strong>{t('chat.quality_title', 'Response quality')}</strong>
                    <div>{t('chat.quality_summary', '{{score}}/100 · {{status}}', {
                        score: msg.quality.score,
                        status: t(`chat.quality_status.${msg.quality.status}`, msg.quality.status),
                    })}</div>
                    {msg.quality.failed_checks.length > 0 && (
                        <div>{t('chat.quality_failed_checks', 'Needs attention: {{checks}}', {
                            checks: msg.quality.failed_checks.map(value => t(`chat.quality_check.${value}`, value)).join(', '),
                        })}</div>
                    )}
                </div>
            )}
            {msg.evidenceSecurity?.status === 'tainted' && (
                <div style={{ marginTop: '5px' }}>
                    <strong>{t('chat.evidence_security_title', 'Untrusted evidence detected')}</strong>
                    <div>{t('chat.evidence_security_summary', '{{count}} suspicious pattern categories were isolated; authorization was not changed.', {
                        count: msg.evidenceSecurity.categories.length,
                    })}</div>
                </div>
            )}
            {(msg.conflicts?.count ?? 0) > 0 && msg.conflicts && (
                <div style={{ marginTop: '5px' }}>
                    <strong>{t('chat.conflicts_title', 'Conflicting evidence')}</strong>
                    <div>{t('chat.conflicts_summary', '{{count}} conflicting field(s); values remain private in diagnostics.', { count: msg.conflicts.count })}</div>
                    {msg.conflicts.conflicts.map(item => (
                        <div key={item.conflict_id}>{t('chat.conflict_item', '{{entity}} · {{field}} · {{sources}}', {
                            entity: item.entity_id,
                            field: item.field,
                            sources: item.source_names.join(', '),
                        })}</div>
                    ))}
                </div>
            )}
            {msg.freshness && (
                <div style={{ marginTop: '5px' }}>
                    <strong>{t('chat.freshness_title', 'Index freshness')}</strong>
                    <div>{t('chat.freshness_summary', '{{status}} · age {{age}} s · {{coverage}}% cached · {{direct}} direct read(s)', {
                        status: t(`chat.freshness_status.${msg.freshness.status}`, msg.freshness.status),
                        age: msg.freshness.age_seconds ?? 0,
                        coverage: Math.round(msg.freshness.coverage_ratio * 100),
                        direct: msg.freshness.direct_reads,
                    })}</div>
                    {msg.freshness.refresh_scheduled && <div>{t('chat.freshness_refresh', 'A non-blocking refresh was requested.')}</div>}
                </div>
            )}
            {msg.job && (
                <div style={{ marginTop: '5px' }}>
                    <strong>{t('chat.job_title', 'Background job')}</strong>
                    <div>{t('chat.job_summary', '{{id}} · {{status}}', { id: msg.job.job_id, status: t(`chat.job_status.${msg.job.status}`, msg.job.status) })}</div>
                    {msg.job.retry && (
                        <div>
                            {t('chat.job_retry_budget', 'Attempt {{attempt}}/{{maxAttempts}} · model calls {{used}}/{{budget}}', {
                                attempt: msg.job.retry.attempt,
                                maxAttempts: msg.job.retry.max_attempts,
                                used: msg.job.retry.model_calls_used,
                                budget: msg.job.retry.model_call_budget,
                            })}
                            {msg.job.retry.next_retry_at && (
                                <> · {t('chat.job_retry_scheduled', 'next retry {{time}}', { time: new Date(msg.job.retry.next_retry_at).toLocaleTimeString() })}</>
                            )}
                            {msg.job.retry.budget_exhausted && <> · {t('chat.job_retry_exhausted', 'retry budget exhausted')}</>}
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => { onJobAction(); }}>{t('chat.job_refresh', 'Refresh')}</button>
                        {msg.job.capabilities.result && (msg.job.result_available || msg.job.status === 'completed') && (
                            <button type="button" onClick={() => { onFocusComposer(t('chat.job_result_prompt', 'Show the result of {{id}}', { id: jobId })); }}>{t('chat.job_result', 'Read result')}</button>
                        )}
                        {msg.job.capabilities.resume && ['failed', 'interrupted', 'retry_wait'].includes(msg.job.status) && !msg.job.retry?.budget_exhausted && (
                            <button type="button" onClick={() => { onJobAction('resume'); }}>{t('chat.job_resume', 'Resume job')}</button>
                        )}
                        {msg.job.capabilities.cancel && ['queued', 'pending', 'running', 'retry_wait'].includes(msg.job.status) && (
                            <button type="button" onClick={() => { onJobAction('cancel'); }}>{t('chat.job_cancel', 'Cancel job')}</button>
                        )}
                    </div>
                </div>
            )}
            {Boolean(msg.confirmation) && <div>{t('chat.message_has_confirmation', 'This message includes a governed action confirmation.')}</div>}
            {Array.isArray(msg.attachments) && msg.attachments.length > 0 && <div>{t('chat.message_attachments_count', '{{count}} attachment(s)', { count: msg.attachments.length })}</div>}
        </div>
    );
}
