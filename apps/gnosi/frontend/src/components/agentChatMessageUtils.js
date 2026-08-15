const MAX_PROCESSING_MS = 24 * 60 * 60 * 1000;
const TURN_TIMING_MS_FIELDS = [
    'setup_ms', 'routing_ms', 'model_ms', 'tools_ms', 'other_ms', 'total_ms',
];
const TURN_TIMING_COUNT_FIELDS = [
    'input_tokens', 'output_tokens', 'model_calls', 'tool_calls',
];
const PRESENTATION_FIELDS = [
    'processingMs', 'timings', 'feedback', 'saved', 'plan', 'privacy',
    'verification', 'citations', 'freshness', 'job', 'explanation',
];

const boundedString = (value, max = 128) => (
    typeof value === 'string' ? value.trim().slice(0, max) : ''
);
const boundedStrings = (value, maxItems = 16, maxChars = 128) => (
    Array.isArray(value)
        ? value.slice(0, maxItems).map(item => boundedString(item, maxChars)).filter(Boolean)
        : []
);
const boundedCount = value => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0
        ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(numeric))
        : 0;
};

export const boundedTurnPlan = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
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
    };
};

export const boundedPrivacy = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return {
        classification: boundedString(value.classification, 64),
        private_source_count: boundedCount(value.private_source_count),
        remote_model: Boolean(value.remote_model),
        private_evidence_to_remote_model: Boolean(value.private_evidence_to_remote_model),
        data_minimized: Boolean(value.data_minimized),
        cross_domain_reads_blocked: Boolean(value.cross_domain_reads_blocked),
    };
};

export const boundedVerification = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const checks = value.checks && typeof value.checks === 'object' && !Array.isArray(value.checks)
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

const boundedSourceHref = value => {
    const href = boundedString(value, 2000);
    if (
        href.startsWith('/vault/page/')
        || href.startsWith('/reader?article=')
        || /^https?:\/\//i.test(href)
    ) return href;
    return '';
};

export const boundedCitations = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const sources = Array.isArray(value.sources)
        ? value.sources.slice(0, 96).map(source => ({
            citation_id: boundedString(source?.citation_id, 64),
            source_id: boundedString(source?.source_id, 192),
            title: boundedString(source?.title, 240),
            source_type: boundedString(source?.source_type, 64),
            href: boundedSourceHref(source?.href),
        })).filter(source => source.citation_id && source.title)
        : [];
    const knownIds = new Set(sources.map(source => source.citation_id));
    const claims = Array.isArray(value.claims)
        ? value.claims.slice(0, 128).map(claim => ({
            claim_id: boundedString(claim?.claim_id, 64),
            line_index: boundedCount(claim?.line_index),
            text: boundedString(claim?.text, 320),
            citation_ids: boundedStrings(claim?.citation_ids, 12, 64)
                .filter(citationId => knownIds.has(citationId)),
        })).filter(claim => claim.claim_id && claim.text && claim.citation_ids.length)
        : [];
    return {
        schema_version: boundedCount(value.schema_version),
        status: boundedString(value.status, 32),
        claim_count: claims.length,
        source_count: new Set(
            claims.flatMap(claim => claim.citation_ids),
        ).size,
        sources,
        claims,
        limitations: boundedStrings(value.limitations, 8, 128),
    };
};

export const boundedFreshness = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
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

export const boundedJob = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !value.job_id) return null;
    const progress = Number(value.progress);
    return {
        job_id: boundedString(value.job_id, 256),
        provider: boundedString(value.provider, 64),
        status: boundedString(value.status || value.state, 64),
        progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null,
        result_available: Boolean(value.result_available),
        retry: value.retry && typeof value.retry === 'object' && !Array.isArray(value.retry)
            ? {
                automatic_enabled: Boolean(value.retry.automatic_enabled),
                attempt: boundedCount(value.retry.attempt),
                max_attempts: boundedCount(value.retry.max_attempts),
                next_retry_at: boundedString(value.retry.next_retry_at, 64) || null,
                model_call_budget: boundedCount(value.retry.model_call_budget),
                model_calls_used: boundedCount(value.retry.model_calls_used),
                last_retry_reason: boundedString(value.retry.last_retry_reason, 128) || null,
                budget_exhausted: Boolean(value.retry.budget_exhausted),
            }
            : null,
        capabilities: {
            status: value.capabilities?.status !== false,
            result: Boolean(value.capabilities?.result),
            resume: Boolean(value.capabilities?.resume),
            cancel: Boolean(value.capabilities?.cancel),
            automatic_retry: Boolean(value.capabilities?.automatic_retry),
        },
    };
};

export const boundedExplanation = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return {
        mode: boundedString(value.mode, 32),
        route: boundedString(value.route, 32),
        execution: boundedString(value.execution, 32),
        output_strategy: boundedString(value.output_strategy, 32),
        tools_used: boundedStrings(value.tools_used, 16, 128),
        evidence_count: boundedCount(value.evidence_count),
        citation_count: boundedCount(value.citation_count),
    };
};

export const boundedTransparencyMetadata = value => ({
    plan: boundedTurnPlan(value?.plan),
    privacy: boundedPrivacy(value?.privacy),
    verification: boundedVerification(value?.verification),
    citations: boundedCitations(value?.citations),
    freshness: boundedFreshness(value?.freshness),
    job: boundedJob(value?.job),
    explanation: boundedExplanation(value?.explanation),
});

export const boundedProcessingMs = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.min(MAX_PROCESSING_MS, Math.round(numeric));
};

export const processingSeconds = (processingMs) => {
    const bounded = boundedProcessingMs(processingMs);
    if (bounded === null) return null;
    return Math.max(1, Math.ceil(bounded / 1000));
};

export const boundedTurnMetrics = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const metrics = {};
    TURN_TIMING_MS_FIELDS.forEach((field) => {
        const bounded = boundedProcessingMs(value[field]);
        if (bounded !== null) metrics[field] = bounded;
    });
    TURN_TIMING_COUNT_FIELDS.forEach((field) => {
        const numeric = Number(value[field]);
        if (Number.isFinite(numeric) && numeric >= 0) {
            metrics[field] = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(numeric));
        }
    });
    return Object.keys(metrics).length ? metrics : null;
};

export const conversationRewindPlan = (messages, messageIndex) => {
    if (
        !Array.isArray(messages)
        || !Number.isInteger(messageIndex)
        || messageIndex < 0
        || messageIndex >= messages.length
    ) {
        return null;
    }

    let turnStart = messageIndex;
    while (turnStart > 0 && messages[turnStart]?.role !== 'user') {
        turnStart -= 1;
    }
    if (messages[turnStart]?.role !== 'user') turnStart = 0;

    const turn = messages.slice(turnStart, messageIndex + 1);
    const userMessage = turn.find((message) => message?.role === 'user');
    const prefix = messages.slice(0, turnStart);
    return {
        beforeTurnId: userMessage?.turnId || null,
        keepMessages: prefix.filter(
            (message) => message?.role === 'user' || message?.role === 'assistant',
        ).length,
        localKeepCount: turnStart,
        prompt: String(userMessage?.content || ''),
    };
};

export const mergeCanonicalMessageMetadata = (canonical, cached) => {
    if (!Array.isArray(canonical)) return [];
    const localMessages = Array.isArray(cached) ? cached : [];
    let localCursor = 0;

    return canonical.map((message) => {
        const normalizedMessage = message?.turn_id && !message?.turnId
            ? { ...message, turnId: message.turn_id }
            : message;
        let match = null;
        for (let index = localCursor; index < localMessages.length; index += 1) {
            const candidate = localMessages[index];
            if (
                candidate?.role === normalizedMessage?.role
                && String(candidate?.content || '') === String(normalizedMessage?.content || '')
            ) {
                match = candidate;
                localCursor = index + 1;
                break;
            }
        }
        if (!match) return normalizedMessage;

        const metadata = {};
        PRESENTATION_FIELDS.forEach((field) => {
            if (match[field] !== undefined) metadata[field] = match[field];
        });
        if (metadata.processingMs !== undefined) {
            metadata.processingMs = boundedProcessingMs(metadata.processingMs);
        }
        if (metadata.timings !== undefined) {
            metadata.timings = boundedTurnMetrics(metadata.timings);
        }
        Object.entries(boundedTransparencyMetadata(metadata)).forEach(([field, value]) => {
            if (value !== null) metadata[field] = value;
        });
        return { ...normalizedMessage, ...metadata };
    });
};
