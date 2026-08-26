import { isCitationHref } from '../lib/citationDeepLink';

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
    'total_ms_value',
    'total_milliseconds',
    'elapsed_ms',
    'elapsed',
    'elapsedMs',
    'elapsed_seconds',
    'elapsedSecs',
    'elapsedSec',
    'latency_ms',
    'latency',
    'latency_seconds',
    'latencySecs',
    'latencySec',
    'response_ms',
    'response_time_ms',
    'response_time',
    'responseTime',
    'responseSec',
    'response_seconds',
    'responseSecs',
    'processing_ms',
    'processing',
    'processingMs',
    'processing_ms_value',
    'processing_time_ms',
    'processing_time',
    'processingTime',
    'duration_ms',
    'duration_ms_value',
    'durationMs',
    'durationInMs',
    'duration_in_ms',
    'duration_seconds',
    'durationSeconds',
    'durationSecs',
    'durationSec',
    'duration_s',
    'total_seconds',
    'totalSecs',
    'totalSec',
    'seconds',
    'seconds_time',
    'time_ms',
    'time',
    'time_ms_value',
    'time_seconds',
    'timeSec',
    'timeSecs',
    'timing_ms',
    'timing',
    'timing_seconds',
    'timingSecs',
    'timingSec',
];
const PRESENTATION_FIELDS = [
    'turnId', 'turn_id', 'processingMs', 'timings',
    'feedback', 'saved', 'plan', 'privacy',
    'verification', 'citations', 'freshness', 'job', 'explanation',
    'errorCode', 'retryable', 'recovery', 'processingPhase',
];

const normalizeTurnIdCandidateKey = (value) => {
    if (typeof value !== 'string') return '';
    const normalized = value.trim().toLowerCase();
    if (!normalized) return '';
    return normalized
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
};

const isTurnIdCandidateField = (normalizedKey) => {
    if (!normalizedKey) return false;
    if (normalizedKey === 'turn') return true;
    if (
        normalizedKey === 'turn_id'
        || normalizedKey === 'turnid'
        || normalizedKey === 'gnosi_turn'
        || normalizedKey === 'gnosi_turn_id'
    ) return true;
    if (normalizedKey === 'session_id' || normalizedKey === 'conversation_id') return true;
    return (
        /(?:^|_)(?:turn|session|conversation|trace|thread)_(?:id|uuid|identifier|ref|reference|key|token)$/.test(normalizedKey)
        || /(?:^|_)(?:id|uuid|identifier|ref|reference|key|token)_(?:turn|session|conversation|trace|thread)$/.test(normalizedKey)
        || normalizedKey.endsWith('_turn_id')
        || normalizedKey.startsWith('turn_')
        || normalizedKey.includes('_turn_')
    );
};

const extractTurnCandidateId = (candidate, seen = new Set()) => {
    if (candidate === null || candidate === undefined || candidate === '') return null;
    if (typeof candidate === 'string' || typeof candidate === 'number') {
        return candidate;
    }
    if (typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const objectId = candidate.id
        || candidate.turnId
        || candidate.turn_id
        || candidate.value
        || candidate.uuid
        || candidate.identifier
        || candidate.key;
    if (objectId !== undefined && objectId !== null && objectId !== '') {
        return objectId;
    }
    const candidateCandidates = collectTurnCandidateEntries(candidate);
    for (const { value } of candidateCandidates) {
        if (typeof value === 'string' || typeof value === 'number') {
            return value;
        }
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            if (seen.has(value)) continue;
            seen.add(value);
            const nested = extractTurnCandidateId(value, seen);
            if (nested !== null && nested !== '' && nested !== undefined && nested !== null) {
                return nested;
            }
        }
    }
    return null;
};

const collectTurnCandidateEntries = (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
    const candidates = [];
    for (const [field, value] of Object.entries(payload)) {
        const normalized = normalizeTurnIdCandidateKey(field);
        if (!isTurnIdCandidateField(normalized)) continue;
        candidates.push({ value });
    }
    return candidates;
};

export const getTurnId = (message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
    if (message.turnId !== undefined && message.turnId !== null && message.turnId !== '') {
        return message.turnId;
    }
    if (message.turn_id !== undefined && message.turn_id !== null && message.turn_id !== '') {
        return message.turn_id;
    }
    const turnValue = message.turn;
    if (typeof turnValue === 'string' || typeof turnValue === 'number') {
        return turnValue;
    }
    if (turnValue && typeof turnValue === 'object' && !Array.isArray(turnValue)) {
        return (
            turnValue.id
            || turnValue.turn_id
            || turnValue.turnId
            || turnValue.value
            || null
        );
    }
    const directContainers = collectTurnCandidateEntries(message);
    for (const candidate of directContainers) {
        const candidateValue = extractTurnCandidateId(candidate.value);
        if (candidateValue !== null && candidateValue !== '' && candidateValue !== undefined) {
            return candidateValue;
        }
    }
    const nestedContainers = [
        message?.metadata,
        message?.additional_kwargs,
        message?.turn_metadata,
    ];
    for (const nested of nestedContainers) {
        for (const candidate of collectTurnCandidateEntries(nested || {})) {
            const candidateValue = extractTurnCandidateId(candidate.value);
            if (candidateValue !== null && candidateValue !== '' && candidateValue !== undefined) {
                return candidateValue;
            }
        }
    }
    return null;
};


const normalizeTimingCandidateKey = (value) => {
    if (typeof value !== 'string') return '';
    const normalized = value.trim();
    if (!normalized) return '';
    const withUnderscore = normalized
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .toLowerCase();
    return withUnderscore;
};

const timingCandidateUnitHint = (normalizedKey) => {
    const key = normalizeTimingCandidateKey(normalizedKey);
    if (!key) return null;
    if (key.includes('ms') || key.includes('millisecond')) {
        return 'ms';
    }
    if (
        key.includes('min')
        || key.includes('_m')
        || key.endsWith('m')
        || key.includes('minute')
    ) {
        return 'm';
    }
    if (
        key.includes('sec')
        || key.includes('second')
        || key.endsWith('s')
        || key.endsWith('_s')
        || key.includes('_secs')
    ) {
        return 's';
    }
    return null;
};

const collectTimingCandidateEntries = (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
    const timingPrefixes = /(?:^|_)(?:total|duration|elapsed|latency|response|processing|timing|time)_[a-z0-9_]+$/;
    const candidates = [];
    for (const [field, value] of Object.entries(payload)) {
        const normalized = normalizeTimingCandidateKey(field);
        if (!normalized) continue;
        const isTimingKey =
            normalized === 'timings'
            || normalized === 'timing'
            || normalized === 'turn_timings'
            || normalized === 'turn_metrics'
            || normalized === 'metrics'
            || normalized === 'metric'
            || timingPrefixes.test(normalized);
        if (!isTimingKey) continue;
        candidates.push({ value, unitHint: timingCandidateUnitHint(normalized) });
    }
    return candidates;
};

const applyDurationUnit = (rawNumeric, unitHint = null) => {
    const numeric = Number(rawNumeric);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    const normalizedUnit = unitHint ? unitHint.trim().toLowerCase() : null;
    if (
        normalizedUnit === 's'
        || normalizedUnit === 'sec'
        || normalizedUnit === 'secs'
        || normalizedUnit === 'second'
        || normalizedUnit === 'seconds'
    ) {
        return boundedProcessingMs(numeric * 1000);
    }
    if (
        normalizedUnit === 'm'
        || normalizedUnit === 'min'
        || normalizedUnit === 'mins'
        || normalizedUnit === 'minute'
        || normalizedUnit === 'minutes'
    ) {
        return boundedProcessingMs(numeric * 60_000);
    }
    if (
        normalizedUnit === 'ms'
        || normalizedUnit === 'millisecond'
        || normalizedUnit === 'milliseconds'
    ) {
        return boundedProcessingMs(numeric);
    }
    if (normalizedUnit) {
        return boundedProcessingMs(numeric);
    }
    return boundedProcessingMs(numeric);
};

const hasCandidatePayload = (message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
    return true;
};

const parseDurationToMs = (value, unitHint = null) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') {
        return applyDurationUnit(value, unitHint);
    }
    if (typeof value === 'string') {
        const normalized = value.trim().replace(/_/g, '');
        if (!normalized) return null;
        const numeric = Number(normalized);
        if (Number.isFinite(numeric)) {
            return applyDurationUnit(numeric, unitHint);
        }
        const withUnit = normalized.match(
            /^([0-9]+(?:\.[0-9]+)?)\s*(ms|millisecond|milliseconds|s|sec|secs|second|seconds|m|min|mins|minutes)$/i,
        );
        if (!withUnit) return null;
        const magnitude = Number(withUnit[1]);
        if (!Number.isFinite(magnitude)) return null;
        return parseDurationToMs(magnitude, withUnit[2]);
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
        if (normalizedUnit) {
            return hintValue;
        }
    }
    return null;
};

const parseTimingObjectMs = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    for (const key of TIMING_OBJECT_TOTAL_FIELDS) {
        const lowered = key.toLowerCase();
        const unitHint = lowered.endsWith('_ms') || lowered.endsWith('_ms_value')
            || /_milliseconds?$/.test(lowered) || lowered.endsWith('ms')
            || lowered === 'durationms'
            || lowered === 'processingms'
            || lowered === 'responsems'
            || lowered === 'elapsedms'
            || lowered === 'latencyms'
            || lowered === 'timingms'
            ? 'ms'
            : /_seconds?$/.test(lowered) || /_secs?$/.test(lowered) || lowered.endsWith('secs')
                || lowered.endsWith('sec')
                || lowered === 'seconds'
                ? 's'
                : null;
        const parsed = parseDurationToMs(value[key], unitHint);
        if (parsed !== null) return parsed;
    }
    const candidateEntries = collectTimingCandidateEntries(value).filter(
        ({ value }) => value != null && value !== false,
    );
    for (const { value: candidateValue, unitHint } of candidateEntries) {
        if (typeof candidateValue === 'number' || typeof candidateValue === 'string') {
            const parsed = parseDurationToMs(candidateValue, unitHint);
            if (parsed !== null) return parsed;
        }
        if (candidateValue && typeof candidateValue === 'object' && !Array.isArray(candidateValue)) {
            const parsed = parseTimingObjectMs(candidateValue);
            if (parsed !== null) return parsed;
        }
    }
    if (value.value !== undefined && value.unit !== undefined) {
        return parseDurationToMs(value.value, value.unit);
    }
    if (value.value !== undefined) {
        const parsedValue = parseDurationToMs(value.value);
        if (parsedValue !== null) return parsedValue;
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
        { value: message.total, unitHint: 'ms' },
        { value: message.total_ms, unitHint: 'ms' },
        { value: message.duration_seconds, unitHint: 's' },
        { value: message.durationSeconds, unitHint: 's' },
        { value: message.duration_secs, unitHint: 's' },
        { value: message.durationSecs, unitHint: 's' },
        { value: message.total_seconds, unitHint: 's' },
        { value: message.totalSeconds, unitHint: 's' },
        { value: message.totalSec, unitHint: 's' },
        { value: message.durationSec, unitHint: 's' },
        { value: message.duration_ms, unitHint: 'ms' },
        { value: message.durationMs, unitHint: 'ms' },
        { value: message.durationInMs, unitHint: 'ms' },
        { value: message.duration_in_ms, unitHint: 'ms' },
        { value: message.duration, unitHint: 'ms' },
        { value: message.response_time, unitHint: 'ms' },
        { value: message.response_time_ms, unitHint: 'ms' },
        { value: message.responseTime, unitHint: 'ms' },
        { value: message.response_time_seconds, unitHint: 's' },
        { value: message.response_seconds, unitHint: 's' },
        { value: message.responseSeconds, unitHint: 's' },
        { value: message.responseTimeSeconds, unitHint: 's' },
        { value: message.responseSecs, unitHint: 's' },
        { value: message.responseSec, unitHint: 's' },
        { value: message.response_secs, unitHint: 's' },
        { value: message.processing_time, unitHint: 'ms' },
        { value: message.processing_time_ms, unitHint: 'ms' },
        { value: message.processingTime, unitHint: 'ms' },
        { value: message.processing_time_seconds, unitHint: 's' },
        { value: message.processing_seconds, unitHint: 's' },
        { value: message.processingSeconds, unitHint: 's' },
        { value: message.processingTimeSeconds, unitHint: 's' },
        { value: message.processingSecs, unitHint: 's' },
        { value: message.processingSec, unitHint: 's' },
        { value: message.processing_secs, unitHint: 's' },
        { value: message.timing_ms, unitHint: 'ms' },
        { value: message.timingMs, unitHint: 'ms' },
        { value: message.timing_ms_value, unitHint: 'ms' },
        { value: message.timing_seconds, unitHint: 's' },
        { value: message.timingSecs, unitHint: 's' },
        { value: message.timingSec, unitHint: 's' },
        { value: message.time, unitHint: 'ms' },
        { value: message.time_ms, unitHint: 'ms' },
        { value: message.time_seconds, unitHint: 's' },
        { value: message.timeSec, unitHint: 's' },
        { value: message.timeSecs, unitHint: 's' },
        { value: message.seconds, unitHint: 's' },
    ];
    const fallbackTimingCandidates = collectTimingCandidateEntries(message).filter(
        ({ value }) => ![message.timings, message.turn_metrics, message.turnMetrics, message.metrics, message.metric, message.timing].includes(value),
    );
    candidateValues.push(...fallbackTimingCandidates);
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

const boundedBudget = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return {
        timeout_seconds: Math.min(3600, boundedCount(value.timeout_seconds)),
        max_model_calls: Math.min(128, boundedCount(value.max_model_calls)),
        max_tool_calls: Math.min(256, boundedCount(value.max_tool_calls)),
        max_read_tool_results: Math.min(256, boundedCount(value.max_read_tool_results)),
    };
};

const boundedIntent = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
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

const boundedCapabilityBroker = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const discoveryDomains = Array.isArray(value.discovery?.domains)
        ? value.discovery.domains.slice(0, 8).map(item => ({
            domain: boundedString(item?.domain, 32),
            status: boundedString(item?.status, 48),
            candidate_tools: boundedStrings(item?.candidate_tools, 8, 128),
            recommended_action: boundedString(item?.recommended_action, 64),
        })).filter(item => item.domain)
        : [];
    return {
        broker_version: boundedString(value.broker_version, 64),
        operation: boundedString(value.operation, 32),
        candidate_tools: boundedStrings(value.candidate_tools, 24, 128),
        guarded_tools: boundedStrings(value.guarded_tools, 24, 128),
        selection_policy: boundedString(value.selection_policy, 128),
        discovery: value.discovery && typeof value.discovery === 'object'
            ? {
                status: boundedString(value.discovery.status, 48),
                domains: discoveryDomains,
                automatic_install: Boolean(value.discovery.automatic_install),
                automatic_permission_grant: Boolean(value.discovery.automatic_permission_grant),
            }
            : null,
    };
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
        budgets: boundedBudget(value.budgets),
        deadline: value.deadline && typeof value.deadline === 'object' && !Array.isArray(value.deadline)
            ? {
                hard_seconds: Math.min(3600, boundedCount(value.deadline.hard_seconds)),
                soft_seconds: Math.min(3600, boundedCount(value.deadline.soft_seconds)),
                synthesis_reserve_seconds: Math.min(600, boundedCount(value.deadline.synthesis_reserve_seconds)),
                policy: boundedString(value.deadline.policy, 96),
            }
            : null,
        interpretation: boundedIntent(value.interpretation),
        capability_broker: boundedCapabilityBroker(value.capability_broker),
        memory: value.memory && typeof value.memory === 'object' && !Array.isArray(value.memory)
            ? {
                checkpointed: Boolean(value.memory.checkpointed),
                scope: boundedString(value.memory.scope, 64),
                historical_tool_payloads_excluded: Boolean(value.memory.historical_tool_payloads_excluded),
            }
            : null,
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
        || /^\/@[^/]+\/knowledge\/page\//.test(href)
        || href.startsWith('/reader?article=')
        || /^\/@[^/]+\/reader(?:\?|\/)/.test(href)
        || isCitationHref(href)
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
            source_version: boundedString(source?.source_version, 128),
            version_status: boundedString(source?.version_status, 32),
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
        budgets: boundedBudget(value.budgets),
        tools_used: boundedStrings(value.tools_used, 16, 128),
        evidence_count: boundedCount(value.evidence_count),
        citation_count: boundedCount(value.citation_count),
        quality_score: Math.min(100, boundedCount(value.quality_score)),
    };
};

export const boundedQuality = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const checks = value.checks && typeof value.checks === 'object' && !Array.isArray(value.checks)
        ? Object.fromEntries(Object.entries(value.checks).slice(0, 12).map(([key, passed]) => [
            boundedString(key, 64), Boolean(passed),
        ]).filter(([key]) => key))
        : {};
    return {
        schema_version: boundedCount(value.schema_version),
        score: Math.min(100, boundedCount(value.score)),
        status: boundedString(value.status, 32),
        checks,
        failed_checks: boundedStrings(value.failed_checks, 12, 64),
    };
};

export const boundedConflicts = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const conflicts = Array.isArray(value.conflicts)
        ? value.conflicts.slice(0, 12).map(item => ({
            conflict_id: boundedString(item?.conflict_id, 64),
            entity_id: boundedString(item?.entity_id, 192),
            field: boundedString(item?.field, 96),
            source_names: boundedStrings(item?.source_names, 8, 128),
            value_count: boundedCount(item?.value_count),
        })).filter(item => item.conflict_id)
        : [];
    return {
        schema_version: boundedCount(value.schema_version),
        status: boundedString(value.status, 32),
        count: conflicts.length,
        conflicts,
        values_redacted: Boolean(value.values_redacted),
    };
};

export const boundedEvidenceSecurity = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return {
        schema_version: boundedCount(value.schema_version),
        status: boundedString(value.status, 32),
        severity: boundedString(value.severity, 32),
        categories: Array.isArray(value.categories)
            ? value.categories.slice(0, 8).map(item => ({
                category: boundedString(item?.category, 64),
                count: boundedCount(item?.count),
            })).filter(item => item.category)
            : [],
        scanned_char_bucket: boundedCount(value.scanned_char_bucket),
        authorization_changed: Boolean(value.authorization_changed),
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
    quality: boundedQuality(value?.quality),
    conflicts: boundedConflicts(value?.conflicts),
    evidenceSecurity: boundedEvidenceSecurity(value?.evidence_security || value?.evidenceSecurity),
});

export const isRetryableErrorCode = (value) => new Set([
    'agent_loop_exhausted',
    'agent_turn_timeout',
    'timeout',
    'server_error',
    'service_unavailable',
    'rate_limit',
    'rate_limit_exceeded',
    'network_error',
]).has(String(value || '').trim().toLowerCase());

export const boundedProcessingMs = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.min(MAX_PROCESSING_MS, Math.round(numeric));
};

export const processingSeconds = (processingMs) => {
    const bounded = boundedProcessingMs(processingMs);
    if (bounded === null) return null;
    return Math.max(0, Math.round((bounded / 1000) * 10) / 10);
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
    const estimatedCost = Number(value.estimated_cost_usd);
    if (Number.isFinite(estimatedCost) && estimatedCost >= 0) {
        metrics.estimated_cost_usd = Math.min(1_000_000, estimatedCost);
    }
    const budget = boundedBudget(value.budget);
    if (budget) metrics.budget = budget;
    if (value.budget_exhausted && typeof value.budget_exhausted === 'object') {
        metrics.budget_exhausted = {
            model_calls: Boolean(value.budget_exhausted.model_calls),
            tool_calls: Boolean(value.budget_exhausted.tool_calls),
        };
    }
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

export const mergeNotebookConversation = (canonical, cached) => {
    const canonicalMessages = Array.isArray(canonical) ? canonical : [];
    const cachedMessages = Array.isArray(cached) ? cached : [];
    if (!canonicalMessages.length && cachedMessages.length) return cachedMessages;
    return mergeCanonicalMessageMetadata(canonicalMessages, cachedMessages);
};
