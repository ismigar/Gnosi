import {
    isRecord,
    stringifyLooseValue,
    type CandidateEntry,
    type LooseValue,
} from './agentChatMessageTypes';

type TurnId = LooseValue;

const normalizeTurnIdCandidateKey = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const normalized = value.trim().toLowerCase();
    if (!normalized) return '';
    return normalized
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
};

const isTurnIdCandidateField = (normalizedKey: string): boolean => {
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

const collectTurnCandidateEntries = (payload: LooseValue): CandidateEntry[] => {
    if (!isRecord(payload)) return [];
    const candidates: CandidateEntry[] = [];
    for (const [field, value] of Object.entries(payload)) {
        const normalized = normalizeTurnIdCandidateKey(field);
        if (!isTurnIdCandidateField(normalized)) continue;
        candidates.push({ value });
    }
    return candidates;
};

const extractTurnCandidateId = (
    candidate: LooseValue,
    seen = new Set<object>(),
): TurnId => {
    if (candidate === null || candidate === undefined || candidate === '') return null;
    if (typeof candidate === 'string' || typeof candidate === 'number') {
        return candidate;
    }
    if (!isRecord(candidate)) return null;
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
        if (isRecord(value)) {
            if (seen.has(value)) continue;
            seen.add(value);
            const nested = extractTurnCandidateId(value, seen);
            if (nested !== null && nested !== '' && nested !== undefined) {
                return nested;
            }
        }
    }
    return null;
};

export const getTurnId = (message: LooseValue): TurnId => {
    if (!isRecord(message)) return null;
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
    if (isRecord(turnValue)) {
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
        message.metadata,
        message.additional_kwargs,
        message.turn_metadata,
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

export const normalizeMessageTurnId = (message: LooseValue): LooseValue => {
    if (!isRecord(message)) return message;
    const turnId = getTurnId(message);
    if (turnId && message.turnId == null) {
        return { ...message, turnId: stringifyLooseValue(turnId) };
    }
    return message;
};
