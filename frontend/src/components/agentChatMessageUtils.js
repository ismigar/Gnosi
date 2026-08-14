const MAX_PROCESSING_MS = 24 * 60 * 60 * 1000;
const PRESENTATION_FIELDS = ['processingMs', 'feedback', 'saved'];

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
        return { ...normalizedMessage, ...metadata };
    });
};
