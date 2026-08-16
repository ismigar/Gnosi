const MAX_PROCESSING_MS = 24 * 60 * 60 * 1000;
const TURN_TIMING_MS_FIELDS = [
    'setup_ms', 'routing_ms', 'model_ms', 'tools_ms', 'other_ms', 'total_ms',
];
const TURN_TIMING_COUNT_FIELDS = [
    'input_tokens', 'output_tokens', 'model_calls', 'tool_calls',
];
const TIMING_OBJECT_TOTAL_FIELDS = [
    'total_ms',
    'total',
    'elapsed_ms',
    'elapsed',
    'latency_ms',
    'latency',
    'response_ms',
    'response_time_ms',
    'processing_ms',
    'processing',
    'duration_ms',
    'durationMs',
    'duration_seconds',
    'durationSecs',
    'durationSec',
    'duration_s',
    'time_ms',
    'time',
];
const PRESENTATION_FIELDS = [
    'turnId', 'turn_id', 'processingMs', 'timings',
    'feedback', 'saved', 'plan', 'privacy',
    'verification', 'citations', 'freshness', 'job', 'explanation',
];

const getTurnId = (message) => (
    message?.turnId || message?.turn_id || message?.turn?.id || null
);
const hasCandidatePayload = (message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
    return true;
};

const parseDurationToMs = (value, unitHint = null) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric < 0) return null;
        if (unitHint === 's') {
            return boundedProcessingMs(numeric * 1000);
        }
        if (unitHint === 'm') {
            return boundedProcessingMs(numeric * 60_000);
        }
        return boundedProcessingMs(numeric);
    }
    if (typeof value === 'string') {
        const normalized = value.trim().replace(/_/g, '');
        if (!normalized) return null;
        const numeric = Number(normalized);
        if (Number.isFinite(numeric)) {
            return boundedProcessingMs(numeric);
        }
        const withUnit = normalized.match(
            /^([0-9]+(?:\.[0-9]+)?)\s*(ms|millisecond|milliseconds|s|sec|secs|second|seconds|m|min|mins|minutes)$/i,
        );
        if (!withUnit) return null;
        const magnitude = Number(withUnit[1]);
        if (!Number.isFinite(magnitude)) return null;
        const unit = withUnit[2].toLowerCase();
        switch (unit) {
            case 's':
            case 'sec':
            case 'secs':
            case 'second':
            case 'seconds':
                return boundedProcessingMs(magnitude * 1000);
            case 'm':
            case 'min':
            case 'mins':
            case 'minutes':
                return boundedProcessingMs(magnitude * 60_000);
            default:
                return boundedProcessingMs(magnitude);
        }
    }
    if (unitHint && typeof unitHint === 'string') {
        const normalizedUnit = unitHint.trim().toLowerCase();
        const hintValue = parseDurationToMs(value);
        if (hintValue === null) return null;
        if (
            normalizedUnit === 'ms'
            || normalizedUnit === 'millisecond'
            || normalizedUnit === 'milliseconds'
        ) {
            return hintValue;
        }
        if (
            normalizedUnit === 's'
            || normalizedUnit === 'sec'
            || normalizedUnit === 'secs'
            || normalizedUnit === 'second'
            || normalizedUnit === 'seconds'
        ) {
            return boundedProcessingMs(hintValue * 1000);
        }
        if (
            normalizedUnit === 'm'
            || normalizedUnit === 'min'
            || normalizedUnit === 'mins'
            || normalizedUnit === 'minutes'
        ) {
            return boundedProcessingMs(hintValue * 60_000);
        }
    }
    return null;
};

const parseTimingObjectMs = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    for (const key of TIMING_OBJECT_TOTAL_FIELDS) {
        const parsed = parseDurationToMs(value[key]);
        if (parsed !== null) return parsed;
    }
    if (value.value !== undefined && value.unit !== undefined) {
        return parseDurationToMs(value.value, value.unit);
    }
    return null;
};

const firstUnusedCandidateIndex = (indices, candidateUsed, fromIndex) => {
    if (!Array.isArray(indices)) return null;
    for (let i = fromIndex; i < indices.length; i += 1) {
        const candidateIndex = indices[i];
        if (!candidateUsed.has(candidateIndex)) return candidateIndex;
    }
    return null;
};

const timedPayloadFromMessage = (message) => {
    if (!hasCandidatePayload(message)) return null;
    const candidateValues = [
        { value: message.timings, unitHint: null },
        { value: message.turn_metrics, unitHint: null },
        { value: message.turnMetrics, unitHint: null },
        { value: message.metrics, unitHint: null },
        { value: message.metric, unitHint: null },
        { value: message.timing, unitHint: null },
        { value: message.duration_seconds, unitHint: 's' },
        { value: message.duration_secs, unitHint: 's' },
        { value: message.durationSec, unitHint: 's' },
        { value: message.duration_ms, unitHint: 'ms' },
        { value: message.durationMs, unitHint: 'ms' },
        { value: message.duration, unitHint: 'ms' },
    ];
    for (const { value, unitHint } of candidateValues) {
        const candidate = value;
        const fromNumber = parseDurationToMs(candidate, unitHint);
        if (fromNumber !== null && (typeof candidate === 'number' || typeof candidate === 'string')) {
            return { total_ms: fromNumber };
        }
        if (hasCandidatePayload(candidate)) {
            const parsedTimingMs = parseTimingObjectMs(candidate);
            if (parsedTimingMs !== null) {
                const bounded = boundedTurnMetrics(candidate) || {};
                bounded.total_ms = parsedTimingMs;
                return bounded;
            }
        }
        const bounded = boundedTurnMetrics(candidate);
        if (bounded !== null) return bounded;
    }
    return null;
};

const normalizeMessageTurnId = (message) => {
    if (!hasCandidatePayload(message)) return message;
    const turnId = getTurnId(message);
    if (turnId && message?.turnId == null) {
        return { ...message, turnId: String(turnId) };
    }
    return message;
};

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

export const effectiveMessageTimingMs = (message) => {
    const timings = timedPayloadFromMessage(message);
    if (timings && timings.total_ms !== undefined) {
        return timings.total_ms;
    }
    return boundedProcessingMs(
        message?.processingMs
            ?? message?.duration_ms
            ?? message?.durationMs
            ?? message?.duration,
    );
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
        beforeTurnId: getTurnId(userMessage),
        keepMessages: prefix.filter(
            (message) => message?.role === 'user' || message?.role === 'assistant',
        ).length,
        localKeepCount: turnStart,
        prompt: String(userMessage?.content || ''),
    };
};

export const mergeCanonicalMessageMetadata = (canonical, cached) => {
    if (!Array.isArray(canonical)) return [];
    const localMessages = Array.isArray(cached)
        ? cached.map(normalizeMessageTurnId)
        : [];
    const localTurnMap = new Map();

    localMessages.forEach((message, index) => {
        const role = message?.role;
        const turnId = getTurnId(message);
        if (!role || !turnId) return;
        const key = `${role}:${String(turnId)}`;
        const bucket = localTurnMap.get(key);
        if (bucket) {
            bucket.push(index);
        } else {
            localTurnMap.set(key, [index]);
        }
    });

    const usedLocalIndices = new Set();
    let localCursor = 0;

    const findByRoleAndContent = (message, startFrom = localCursor) => {
        for (let index = startFrom; index < localMessages.length; index += 1) {
            if (usedLocalIndices.has(index)) continue;
            const candidate = localMessages[index];
            if (
                candidate?.role === message?.role
                && String(candidate?.content || '') === String(message?.content || '')
            ) {
                return index;
            }
        }
        return null;
    };

    const findByRoleOnly = (message, startFrom = localCursor) => {
        for (let index = startFrom; index < localMessages.length; index += 1) {
            if (usedLocalIndices.has(index)) continue;
            if (localMessages[index]?.role === message?.role) {
                return index;
            }
        }
        return null;
    };

    return canonical.map((message) => {
        const normalizedMessage = normalizeMessageTurnId(message);
        let matchIndex = null;
        const messageTurnId = getTurnId(normalizedMessage);
        if (messageTurnId) {
            const matchCandidates = localTurnMap.get(
                `${normalizedMessage?.role}:${String(messageTurnId)}`,
            );
            matchIndex = firstUnusedCandidateIndex(
                matchCandidates,
                usedLocalIndices,
                matchCandidates ? 0 : 0,
            );
        }
        if (matchIndex === null && localCursor < localMessages.length) {
            matchIndex = findByRoleAndContent(normalizedMessage);
        }
        if (matchIndex === null && localCursor < localMessages.length) {
            matchIndex = findByRoleOnly(normalizedMessage);
        }
        if (matchIndex === null) return normalizedMessage;
        const match = localMessages[matchIndex];
        usedLocalIndices.add(matchIndex);
        localCursor = Math.max(localCursor, matchIndex + 1);

        const metadata = {};
        PRESENTATION_FIELDS.forEach((field) => {
            if (match[field] !== undefined) metadata[field] = match[field];
        });

        const sourceTiming = timedPayloadFromMessage(match);
        if (sourceTiming && metadata.timings === undefined && normalizedMessage?.role === 'assistant') {
            metadata.timings = sourceTiming;
        }

        if (metadata.timings !== undefined) {
            metadata.timings = timedPayloadFromMessage(metadata);
            if (metadata.processingMs === undefined && metadata.timings?.total_ms !== undefined) {
                metadata.processingMs = boundedProcessingMs(metadata.timings.total_ms);
            }
        }
        if (metadata.processingMs !== undefined) {
            metadata.processingMs = boundedProcessingMs(metadata.processingMs);
        } else {
            const fromMatchProcessing = boundedProcessingMs(
                match?.processingMs ?? match?.duration_ms ?? match?.durationMs ?? match?.duration,
            );
            if (fromMatchProcessing !== null) {
                metadata.processingMs = fromMatchProcessing;
            }
        }
        Object.entries(boundedTransparencyMetadata(metadata)).forEach(([field, value]) => {
            if (value !== null) metadata[field] = value;
        });
        return { ...normalizedMessage, ...metadata };
    });
};
