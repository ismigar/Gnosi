import { isCitationHref } from '../../../shared/resources/citationDeepLink';
import {
    isLooseArray,
    isRecord,
    stringifyLooseValue,
    type LooseValue,
} from './agentChatMessageTypes';

const boundedString = (value: LooseValue, max = 128): string => (
    typeof value === 'string' ? value.trim().slice(0, max) : ''
);
const boundedStrings = (value: LooseValue, maxItems = 16, maxChars = 128): string[] => (
    isLooseArray(value)
        ? value.slice(0, maxItems).map(item => boundedString(item, maxChars)).filter(Boolean)
        : []
);
const boundedCount = (value: LooseValue): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0
        ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(numeric))
        : 0;
};

export const boundedBudget = (value: LooseValue) => {
    if (!isRecord(value)) return null;
    return {
        timeout_seconds: Math.min(3600, boundedCount(value.timeout_seconds)),
        max_model_calls: Math.min(128, boundedCount(value.max_model_calls)),
        max_tool_calls: Math.min(256, boundedCount(value.max_tool_calls)),
        max_read_tool_results: Math.min(256, boundedCount(value.max_read_tool_results)),
    };
};

const boundedIntent = (value: LooseValue) => {
    if (!isRecord(value)) return null;
    return {
        operation: boundedString(value.operation, 32),
        domains: boundedStrings(value.domains, 8, 32),
        concepts: boundedStrings(value.concepts, 16, 64),
        retrieval_strategies: boundedStrings(value.retrieval_strategies, 8, 48),
        ambiguities: boundedStrings(value.ambiguities, 8, 64),
        confidence: Number.isFinite(Number(value.confidence))
            ? Math.max(0, Math.min(1, Number(value.confidence)))
            : 0,
        relation_requested: Boolean(value.relation_requested),
        clarification_required: Boolean(value.clarification_required),
        abstain: Boolean(value.abstain),
    };
};

const boundedCapabilityBroker = (value: LooseValue) => {
    if (!isRecord(value)) return null;
    const discovery = isRecord(value.discovery) ? value.discovery : null;
    const discoveryDomains = isLooseArray(discovery?.domains)
        ? discovery.domains.slice(0, 8).map(item => {
            const record = isRecord(item) ? item : {};
            return {
                domain: boundedString(record.domain, 32),
                status: boundedString(record.status, 48),
                candidate_tools: boundedStrings(record.candidate_tools, 8, 128),
                recommended_action: boundedString(record.recommended_action, 64),
            };
        }).filter(item => item.domain)
        : [];
    return {
        broker_version: boundedString(value.broker_version, 64),
        operation: boundedString(value.operation, 32),
        candidate_tools: boundedStrings(value.candidate_tools, 24, 128),
        guarded_tools: boundedStrings(value.guarded_tools, 24, 128),
        selection_policy: boundedString(value.selection_policy, 128),
        discovery: discovery
            ? {
                status: boundedString(discovery.status, 48),
                domains: discoveryDomains,
                automatic_install: Boolean(discovery.automatic_install),
                automatic_permission_grant: Boolean(discovery.automatic_permission_grant),
            }
            : null,
    };
};

export const boundedTurnPlan = (value: LooseValue) => {
    if (!isRecord(value)) return null;
    const deadline = isRecord(value.deadline) ? value.deadline : null;
    const memory = isRecord(value.memory) ? value.memory : null;
    return {
        schema_version: boundedCount(value.schema_version),
        planner_version: boundedString(value.planner_version),
        plan_id: boundedString(value.plan_id, 64),
        mode: boundedString(value.mode, 32),
        domains: boundedStrings(value.domains, 12, 32),
        route: boundedString(value.route, 32),
        execution: boundedString(value.execution, 32),
        output_strategy: boundedString(value.output_strategy, 32),
        required_tool: boundedString(value.required_tool, 128),
        allowed_tool_count: boundedCount(value.allowed_tool_count),
        budgets: boundedBudget(value.budgets),
        deadline: deadline
            ? {
                hard_seconds: Math.min(3600, boundedCount(deadline.hard_seconds)),
                soft_seconds: Math.min(3600, boundedCount(deadline.soft_seconds)),
                synthesis_reserve_seconds: Math.min(600, boundedCount(deadline.synthesis_reserve_seconds)),
                policy: boundedString(deadline.policy, 96),
            }
            : null,
        interpretation: boundedIntent(value.interpretation),
        capability_broker: boundedCapabilityBroker(value.capability_broker),
        memory: memory
            ? {
                checkpointed: Boolean(memory.checkpointed),
                scope: boundedString(memory.scope, 64),
                historical_tool_payloads_excluded: Boolean(memory.historical_tool_payloads_excluded),
            }
            : null,
    };
};

export const boundedPrivacy = (value: LooseValue) => {
    if (!isRecord(value)) return null;
    return {
        classification: boundedString(value.classification, 64),
        private_source_count: boundedCount(value.private_source_count),
        remote_model: Boolean(value.remote_model),
        private_evidence_to_remote_model: Boolean(value.private_evidence_to_remote_model),
        data_minimized: Boolean(value.data_minimized),
        cross_domain_reads_blocked: Boolean(value.cross_domain_reads_blocked),
    };
};

export const boundedVerification = (value: LooseValue) => {
    if (!isRecord(value)) return null;
    const checks = isRecord(value.checks)
        ? {
            required_source_inspected: Boolean(value.checks.required_source_inspected),
            tool_results_successful: Boolean(value.checks.tool_results_successful),
            action_claim_supported: Boolean(value.checks.action_claim_supported),
            claim_citations_complete: Boolean(value.checks.claim_citations_complete),
        }
        : {};
    return {
        status: boundedString(value.status, 32),
        evidence_count: boundedCount(value.evidence_count),
        tool_count: boundedCount(value.tool_count),
        tool_names: boundedStrings(value.tool_names, 16, 128),
        limitations: boundedStrings(value.limitations, 8, 128),
        checks,
    };
};

const boundedSourceHref = (value: LooseValue): string => {
    const href = boundedString(value, 2000);
    if (
        href.startsWith('/vault/page/')
        || /^\/@[^/]+\/knowledge\/page\//.test(href)
        || href.startsWith('/reader?article=')
        || /^\/@[^/]+\/reader(?:\?|\/)/.test(href)
        || isCitationHref(href)
        || /^https?:\/\//i.test(href)
    ) return href;
    return '';
};

export const boundedCitations = (value: LooseValue) => {
    if (!isRecord(value)) return null;
    const sources = isLooseArray(value.sources)
        ? value.sources.slice(0, 96).map(source => {
            const record = isRecord(source) ? source : {};
            return {
                citation_id: boundedString(record.citation_id, 64),
                source_id: boundedString(record.source_id, 192),
                title: boundedString(record.title, 240),
                source_type: boundedString(record.source_type, 64),
                href: boundedSourceHref(record.href),
                source_version: boundedString(record.source_version, 128),
                version_status: boundedString(record.version_status, 32),
            };
        }).filter(source => source.citation_id && source.title)
        : [];
    const knownIds = new Set(sources.map(source => source.citation_id));
    const claims = isLooseArray(value.claims)
        ? value.claims.slice(0, 128).map(claim => {
            const record = isRecord(claim) ? claim : {};
            return {
                claim_id: boundedString(record.claim_id, 64),
                line_index: boundedCount(record.line_index),
                text: boundedString(record.text, 320),
                citation_ids: boundedStrings(record.citation_ids, 12, 64)
                    .filter(citationId => knownIds.has(citationId)),
            };
        }).filter(claim => claim.claim_id && claim.text && claim.citation_ids.length)
        : [];
    return {
        schema_version: boundedCount(value.schema_version),
        status: boundedString(value.status, 32),
        claim_count: claims.length,
        source_count: new Set(claims.flatMap(claim => claim.citation_ids)).size,
        sources,
        claims,
        limitations: boundedStrings(value.limitations, 8, 128),
    };
};

export const boundedFreshness = (value: LooseValue) => {
    if (!isRecord(value)) return null;
    const ratio = Number(value.coverage_ratio);
    return {
        status: boundedString(value.status, 64),
        checked_at: boundedCount(value.checked_at),
        index_built_at: value.index_built_at == null ? null : boundedCount(value.index_built_at),
        age_seconds: value.age_seconds == null ? null : boundedCount(value.age_seconds),
        stale_after_seconds: boundedCount(value.stale_after_seconds),
        requested_records: boundedCount(value.requested_records),
        cached_records: boundedCount(value.cached_records),
        coverage_ratio: Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0,
        direct_reads: boundedCount(value.direct_reads),
        refresh_scheduled: Boolean(value.refresh_scheduled),
        refresh_running: Boolean(value.refresh_running),
    };
};

export const boundedJob = (value: LooseValue) => {
    if (!isRecord(value) || !value.job_id) return null;
    const retry = isRecord(value.retry) ? value.retry : null;
    const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
    const progress = Number(value.progress);
    return {
        job_id: boundedString(value.job_id, 256),
        provider: boundedString(value.provider, 64),
        status: boundedString(value.status || value.state, 64),
        progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null,
        result_available: Boolean(value.result_available),
        retry: retry
            ? {
                automatic_enabled: Boolean(retry.automatic_enabled),
                attempt: boundedCount(retry.attempt),
                max_attempts: boundedCount(retry.max_attempts),
                next_retry_at: boundedString(retry.next_retry_at, 64) || null,
                model_call_budget: boundedCount(retry.model_call_budget),
                model_calls_used: boundedCount(retry.model_calls_used),
                last_retry_reason: boundedString(retry.last_retry_reason, 128) || null,
                budget_exhausted: Boolean(retry.budget_exhausted),
            }
            : null,
        capabilities: {
            status: capabilities.status !== false,
            result: Boolean(capabilities.result),
            resume: Boolean(capabilities.resume),
            cancel: Boolean(capabilities.cancel),
            automatic_retry: Boolean(capabilities.automatic_retry),
        },
    };
};

export const boundedExplanation = (value: LooseValue) => {
    if (!isRecord(value)) return null;
    return {
        mode: boundedString(value.mode, 32),
        route: boundedString(value.route, 32),
        execution: boundedString(value.execution, 32),
        output_strategy: boundedString(value.output_strategy, 32),
        budgets: boundedBudget(value.budgets),
        tools_used: boundedStrings(value.tools_used, 16, 128),
        evidence_count: boundedCount(value.evidence_count),
        citation_count: boundedCount(value.citation_count),
        quality_score: Math.min(100, boundedCount(value.quality_score)),
    };
};

export const boundedQuality = (value: LooseValue) => {
    if (!isRecord(value)) return null;
    const checks: Record<string, boolean> = {};
    if (isRecord(value.checks)) {
        for (const [key, passed] of Object.entries(value.checks).slice(0, 12)) {
            const boundedKey = boundedString(key, 64);
            if (boundedKey) checks[boundedKey] = Boolean(passed);
        }
    }
    return {
        schema_version: boundedCount(value.schema_version),
        score: Math.min(100, boundedCount(value.score)),
        status: boundedString(value.status, 32),
        checks,
        failed_checks: boundedStrings(value.failed_checks, 12, 64),
    };
};

export const boundedConflicts = (value: LooseValue) => {
    if (!isRecord(value)) return null;
    const conflicts = isLooseArray(value.conflicts)
        ? value.conflicts.slice(0, 12).map(item => {
            const record = isRecord(item) ? item : {};
            return {
                conflict_id: boundedString(record.conflict_id, 64),
                entity_id: boundedString(record.entity_id, 192),
                field: boundedString(record.field, 96),
                source_names: boundedStrings(record.source_names, 8, 128),
                value_count: boundedCount(record.value_count),
            };
        }).filter(item => item.conflict_id)
        : [];
    return {
        schema_version: boundedCount(value.schema_version),
        status: boundedString(value.status, 32),
        count: conflicts.length,
        conflicts,
        values_redacted: Boolean(value.values_redacted),
    };
};

export const boundedEvidenceSecurity = (value: LooseValue) => {
    if (!isRecord(value)) return null;
    return {
        schema_version: boundedCount(value.schema_version),
        status: boundedString(value.status, 32),
        severity: boundedString(value.severity, 32),
        categories: isLooseArray(value.categories)
            ? value.categories.slice(0, 8).map(item => {
                const record = isRecord(item) ? item : {};
                return {
                    category: boundedString(record.category, 64),
                    count: boundedCount(record.count),
                };
            }).filter(item => item.category)
            : [],
        scanned_char_bucket: boundedCount(value.scanned_char_bucket),
        authorization_changed: Boolean(value.authorization_changed),
    };
};

export const boundedTransparencyMetadata = (value: LooseValue) => {
    const record = isRecord(value) ? value : {};
    return {
        plan: boundedTurnPlan(record.plan),
        privacy: boundedPrivacy(record.privacy),
        verification: boundedVerification(record.verification),
        citations: boundedCitations(record.citations),
        freshness: boundedFreshness(record.freshness),
        job: boundedJob(record.job),
        explanation: boundedExplanation(record.explanation),
        quality: boundedQuality(record.quality),
        conflicts: boundedConflicts(record.conflicts),
        evidenceSecurity: boundedEvidenceSecurity(
            record.evidence_security || record.evidenceSecurity,
        ),
    };
};

export const isRetryableErrorCode = (value: LooseValue): boolean => new Set([
    'agent_loop_exhausted',
    'agent_turn_timeout',
    'timeout',
    'server_error',
    'service_unavailable',
    'rate_limit',
    'rate_limit_exceeded',
    'network_error',
]).has(stringifyLooseValue(value || '').trim().toLowerCase());
