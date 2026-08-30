import { boundedBudget } from './agentChatTransparency';
import {
    isRecord,
    recordValue,
    type CandidateEntry,
    type DurationUnit,
    type LooseRecord,
    type LooseValue,
} from './agentChatMessageTypes';

const MAX_PROCESSING_MS = 24 * 60 * 60 * 1000;
const TURN_TIMING_MS_FIELDS = [
    'setup_ms', 'routing_ms', 'model_ms', 'tools_ms', 'other_ms', 'total_ms',
] as const;
const TURN_TIMING_COUNT_FIELDS = [
    'input_tokens', 'output_tokens', 'model_calls', 'tool_calls',
] as const;
export type TurnMetrics = LooseRecord & Partial<Record<
    typeof TURN_TIMING_MS_FIELDS[number] | typeof TURN_TIMING_COUNT_FIELDS[number]
    | 'estimated_cost_usd', number
>>;
const TIMING_OBJECT_TOTAL_FIELDS: readonly string[] = [
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

const normalizeTimingCandidateKey = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const normalized = value.trim();
    if (!normalized) return '';
    return normalized
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .toLowerCase();
};

const timingCandidateUnitHint = (normalizedKey: string): DurationUnit | null => {
    const key = normalizeTimingCandidateKey(normalizedKey);
    if (!key) return null;
    if (key.includes('ms') || key.includes('millisecond')) return 'ms';
    if (
        key.includes('min')
        || key.includes('_m')
        || key.endsWith('m')
        || key.includes('minute')
    ) return 'm';
    if (
        key.includes('sec')
        || key.includes('second')
        || key.endsWith('s')
        || key.endsWith('_s')
        || key.includes('_secs')
    ) return 's';
    return null;
};

const collectTimingCandidateEntries = (payload: LooseValue): CandidateEntry[] => {
    if (!isRecord(payload)) return [];
    const timingPrefixes = /(?:^|_)(?:total|duration|elapsed|latency|response|processing|timing|time)_[a-z0-9_]+$/;
    const candidates: CandidateEntry[] = [];
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

export const boundedProcessingMs = (value: LooseValue): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.min(MAX_PROCESSING_MS, Math.round(numeric));
};

const applyDurationUnit = (
    rawNumeric: LooseValue,
    unitHint: string | null = null,
): number | null => {
    const numeric = Number(rawNumeric);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    const normalizedUnit = unitHint ? unitHint.trim().toLowerCase() : null;
    if (
        normalizedUnit === 's'
        || normalizedUnit === 'sec'
        || normalizedUnit === 'secs'
        || normalizedUnit === 'second'
        || normalizedUnit === 'seconds'
    ) return boundedProcessingMs(numeric * 1000);
    if (
        normalizedUnit === 'm'
        || normalizedUnit === 'min'
        || normalizedUnit === 'mins'
        || normalizedUnit === 'minute'
        || normalizedUnit === 'minutes'
    ) return boundedProcessingMs(numeric * 60_000);
    return boundedProcessingMs(numeric);
};

const parseDurationToMs = (
    value: LooseValue,
    unitHint: string | null = null,
): number | null => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return applyDurationUnit(value, unitHint);
    if (typeof value === 'string') {
        const normalized = value.trim().replace(/_/g, '');
        if (!normalized) return null;
        const numeric = Number(normalized);
        if (Number.isFinite(numeric)) return applyDurationUnit(numeric, unitHint);
        const withUnit = normalized.match(
            /^([0-9]+(?:\.[0-9]+)?)\s*(ms|millisecond|milliseconds|s|sec|secs|second|seconds|m|min|mins|minutes)$/i,
        );
        if (!withUnit) return null;
        const magnitudeText = withUnit[1];
        const parsedUnit = withUnit[2];
        if (magnitudeText === undefined || parsedUnit === undefined) return null;
        const magnitude = Number(magnitudeText);
        if (!Number.isFinite(magnitude)) return null;
        return parseDurationToMs(magnitude, parsedUnit);
    }
    if (unitHint) {
        const normalizedUnit = unitHint.trim().toLowerCase();
        const hintValue = parseDurationToMs(value);
        if (hintValue === null) return null;
        if (
            normalizedUnit === 's'
            || normalizedUnit === 'sec'
            || normalizedUnit === 'secs'
            || normalizedUnit === 'second'
            || normalizedUnit === 'seconds'
        ) return boundedProcessingMs(hintValue * 1000);
        if (
            normalizedUnit === 'm'
            || normalizedUnit === 'min'
            || normalizedUnit === 'mins'
            || normalizedUnit === 'minutes'
        ) return boundedProcessingMs(hintValue * 60_000);
        return hintValue;
    }
    return null;
};

const parseTimingObjectMs = (value: LooseValue): number | null => {
    if (!isRecord(value)) return null;
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
        ({ value: candidate }) => candidate != null && candidate !== false,
    );
    for (const { value: candidateValue, unitHint } of candidateEntries) {
        if (typeof candidateValue === 'number' || typeof candidateValue === 'string') {
            const parsed = parseDurationToMs(candidateValue, unitHint);
            if (parsed !== null) return parsed;
        }
        if (isRecord(candidateValue)) {
            const parsed = parseTimingObjectMs(candidateValue);
            if (parsed !== null) return parsed;
        }
    }
    if (value.value !== undefined && value.unit !== undefined) {
        return parseDurationToMs(
            value.value,
            typeof value.unit === 'string' ? value.unit : null,
        );
    }
    if (value.value !== undefined) {
        const parsedValue = parseDurationToMs(value.value);
        if (parsedValue !== null) return parsedValue;
    }
    return null;
};

export const boundedTurnMetrics = (value: LooseValue): TurnMetrics | null => {
    if (!isRecord(value)) return null;
    const metrics: TurnMetrics = {};
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
    if (isRecord(value.budget_exhausted)) {
        metrics.budget_exhausted = {
            model_calls: Boolean(value.budget_exhausted.model_calls),
            tool_calls: Boolean(value.budget_exhausted.tool_calls),
        };
    }
    return Object.keys(metrics).length ? metrics : null;
};

export const timedPayloadFromMessage = (message: unknown): LooseRecord | null => {
    if (!isRecord(message)) return null;
    const candidateValues: CandidateEntry[] = [
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
    const knownContainers = [
        message.timings,
        message.turn_metrics,
        message.turnMetrics,
        message.metrics,
        message.metric,
        message.timing,
    ];
    candidateValues.push(...collectTimingCandidateEntries(message).filter(
        ({ value }) => !knownContainers.includes(value),
    ));
    for (const { value, unitHint } of candidateValues) {
        const fromNumber = parseDurationToMs(value, unitHint);
        if (fromNumber !== null && (typeof value === 'number' || typeof value === 'string')) {
            return { total_ms: fromNumber };
        }
        if (isRecord(value)) {
            const parsedTimingMs = parseTimingObjectMs(value);
            if (parsedTimingMs !== null) {
                const bounded = boundedTurnMetrics(value) || {};
                bounded.total_ms = parsedTimingMs;
                return bounded;
            }
        }
        const bounded = boundedTurnMetrics(value);
        if (bounded !== null) return bounded;
    }
    return null;
};

export const processingSeconds = (processingMs: LooseValue): number | null => {
    const bounded = boundedProcessingMs(processingMs);
    if (bounded === null) return null;
    return Math.max(0, Math.round((bounded / 1000) * 10) / 10);
};

export const effectiveMessageTimingMs = (message: unknown): number | null => {
    const timings = timedPayloadFromMessage(message);
    if (timings && typeof timings.total_ms === 'number') return timings.total_ms;
    return boundedProcessingMs(
        recordValue(message, 'processingMs')
            ?? recordValue(message, 'duration_ms')
            ?? recordValue(message, 'durationMs')
            ?? recordValue(message, 'duration'),
    );
};
