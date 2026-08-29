import {
    asLooseArray,
    isLooseArray,
    isRecord,
    recordValue,
    stringifyLooseValue,
    type LooseRecord,
    type LooseValue,
} from './agentChatMessageTypes';
import { getTurnId, normalizeMessageTurnId } from './agentChatTurnIdentity';
import {
    boundedProcessingMs,
    timedPayloadFromMessage,
} from './agentChatTiming';
import { boundedTransparencyMetadata } from './agentChatTransparency';

const PRESENTATION_FIELDS: readonly string[] = [
    'turnId', 'turn_id', 'processingMs', 'timings',
    'feedback', 'saved', 'plan', 'privacy',
    'verification', 'citations', 'freshness', 'job', 'explanation',
    'errorCode', 'retryable', 'recovery', 'processingPhase',
];

const firstUnusedCandidateIndex = (
    indices: readonly number[] | undefined,
    candidateUsed: ReadonlySet<number>,
    fromIndex: number,
): number | null => {
    if (!indices) return null;
    for (let i = fromIndex; i < indices.length; i += 1) {
        const candidateIndex = indices[i];
        if (candidateIndex === undefined) continue;
        if (!candidateUsed.has(candidateIndex)) return candidateIndex;
    }
    return null;
};

export const conversationRewindPlan = (
    messages: LooseValue,
    messageIndex: number,
) => {
    if (
        !isLooseArray(messages)
        || !Number.isInteger(messageIndex)
        || messageIndex < 0
        || messageIndex >= messages.length
    ) {
        return null;
    }

    let turnStart = messageIndex;
    while (turnStart > 0 && recordValue(messages[turnStart], 'role') !== 'user') {
        turnStart -= 1;
    }
    if (recordValue(messages[turnStart], 'role') !== 'user') turnStart = 0;

    const turn = messages.slice(turnStart, messageIndex + 1);
    const userMessage = turn.find((message) => recordValue(message, 'role') === 'user');
    const prefix = messages.slice(0, turnStart);
    return {
        beforeTurnId: getTurnId(userMessage),
        keepMessages: prefix.filter(
            (message) => recordValue(message, 'role') === 'user'
                || recordValue(message, 'role') === 'assistant',
        ).length,
        localKeepCount: turnStart,
        prompt: stringifyLooseValue(recordValue(userMessage, 'content') || ''),
    };
};

export const mergeCanonicalMessageMetadata = (
    canonical: LooseValue,
    cached: LooseValue,
): LooseValue[] => {
    if (!isLooseArray(canonical)) return [];
    const localMessages = isLooseArray(cached)
        ? cached.map(normalizeMessageTurnId)
        : [];
    const localTurnMap = new Map<string, number[]>();

    localMessages.forEach((message, index) => {
        const role = recordValue(message, 'role');
        const turnId = getTurnId(message);
        if (!role || !turnId) return;
        const key = `${stringifyLooseValue(role)}:${stringifyLooseValue(turnId)}`;
        const bucket = localTurnMap.get(key);
        if (bucket) bucket.push(index);
        else localTurnMap.set(key, [index]);
    });

    const usedLocalIndices = new Set<number>();
    let localCursor = 0;

    const findByRoleAndContent = (
        message: LooseValue,
        startFrom = localCursor,
    ): number | null => {
        for (let index = startFrom; index < localMessages.length; index += 1) {
            if (usedLocalIndices.has(index)) continue;
            const candidate = localMessages[index];
            if (
                recordValue(candidate, 'role') === recordValue(message, 'role')
                && stringifyLooseValue(recordValue(candidate, 'content') || '')
                    === stringifyLooseValue(recordValue(message, 'content') || '')
            ) return index;
        }
        return null;
    };

    const findByRoleOnly = (
        message: LooseValue,
        startFrom = localCursor,
    ): number | null => {
        for (let index = startFrom; index < localMessages.length; index += 1) {
            if (usedLocalIndices.has(index)) continue;
            if (recordValue(localMessages[index], 'role') === recordValue(message, 'role')) {
                return index;
            }
        }
        return null;
    };

    return canonical.map((message) => {
        const normalizedMessage = normalizeMessageTurnId(message);
        let matchIndex: number | null = null;
        const messageTurnId = getTurnId(normalizedMessage);
        if (messageTurnId) {
            const matchCandidates = localTurnMap.get(
                `${stringifyLooseValue(recordValue(normalizedMessage, 'role'))}:${stringifyLooseValue(messageTurnId)}`,
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

        const matchRecord = isRecord(match) ? match : {};
        const normalizedRecord = isRecord(normalizedMessage) ? normalizedMessage : {};
        const metadata: LooseRecord = {};
        PRESENTATION_FIELDS.forEach((field) => {
            if (matchRecord[field] !== undefined) metadata[field] = matchRecord[field];
        });

        const sourceTiming = timedPayloadFromMessage(match);
        if (sourceTiming
            && metadata.timings === undefined
            && normalizedRecord.role === 'assistant') {
            metadata.timings = sourceTiming;
        }

        if (metadata.timings !== undefined) {
            metadata.timings = timedPayloadFromMessage(metadata);
            const normalizedTimings = isRecord(metadata.timings)
                ? metadata.timings
                : null;
            if (metadata.processingMs === undefined && normalizedTimings?.total_ms !== undefined) {
                metadata.processingMs = boundedProcessingMs(normalizedTimings.total_ms);
            }
        }
        if (metadata.processingMs !== undefined) {
            metadata.processingMs = boundedProcessingMs(metadata.processingMs);
        } else {
            const fromMatchProcessing = boundedProcessingMs(
                matchRecord.processingMs
                    ?? matchRecord.duration_ms
                    ?? matchRecord.durationMs
                    ?? matchRecord.duration,
            );
            if (fromMatchProcessing !== null) metadata.processingMs = fromMatchProcessing;
        }
        Object.entries(boundedTransparencyMetadata(metadata)).forEach(([field, value]) => {
            if (value !== null) metadata[field] = value;
        });
        return { ...normalizedRecord, ...metadata };
    });
};

export const mergeNotebookConversation = (
    canonical: LooseValue,
    cached: LooseValue,
): LooseValue[] => {
    const canonicalMessages = asLooseArray(canonical);
    const cachedMessages = asLooseArray(cached);
    if (!canonicalMessages.length && cachedMessages.length) return cachedMessages;
    return mergeCanonicalMessageMetadata(canonicalMessages, cachedMessages);
};
