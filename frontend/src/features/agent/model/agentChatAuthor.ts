import { isRecord, type LooseRecord, type LooseValue } from './agentChatMessageTypes';
import { explicitTurnId } from './agentChatTurnIdentity';

export type AssistantProfileSnapshot = {
    readonly id: string;
    readonly name?: string;
    readonly managed_by?: string;
};

/** Persist only the identity and the raw label needed to localize it on display. */
export function assistantProfileSnapshot(value: unknown, previous?: AssistantProfileSnapshot): AssistantProfileSnapshot | undefined {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return previous;
    const name = typeof value.name === 'string' && value.name.trim() ? value.name : undefined;
    return {
        ...(previous?.id === value.id && !name && previous),
        id: value.id,
        ...(name && { name }),
        ...(typeof value.managed_by === 'string' && value.managed_by ? { managed_by: value.managed_by } : {}),
    };
}

/** Legacy session, conversation and trace identifiers can span multiple turns. */
function explicitAssistantTurn(message: LooseValue): string | undefined {
    return isRecord(message) && message.role === 'assistant' ? explicitTurnId(message) : undefined;
}

export function cachedAssistantTurns(messages: readonly LooseValue[]): Map<string, LooseRecord[]> {
    const turns = new Map<string, LooseRecord[]>();
    for (const message of messages) {
        const id = explicitAssistantTurn(message);
        if (!id || !isRecord(message)) continue;
        const rows = turns.get(id);
        if (rows) rows.push(message);
        else turns.set(id, [message]);
    }
    return turns;
}

export function restoreTurnAttribution(message: LooseValue, turns: ReadonlyMap<string, LooseRecord[]>): LooseValue {
    const id = explicitAssistantTurn(message);
    const rows = id && turns.get(id);
    if (!rows || !isRecord(message)) return message;
    const sameContent = rows.filter(row => row.content === message.content);
    const candidates = sameContent.length ? sameContent : rows;
    const profiles = candidates.map(row => assistantProfileSnapshot(row.assistant_profile)).filter(profile => profile !== undefined);
    const profile = profiles[0];
    const agreedProfile = profile && profiles.every(other =>
        other.id === profile.id && other.name === profile.name && other.managed_by === profile.managed_by);
    const models = candidates.map(row => row.llm).filter(isRecord);
    const model = models[0];
    const agreedModel = model && typeof model.model === 'string' && models.every(other =>
        other.model === model.model && other.provider === model.provider);
    const canonicalProfile = assistantProfileSnapshot(message.assistant_profile);
    const author = assistantProfileSnapshot(canonicalProfile, agreedProfile ? profile : undefined);
    const compatible = !canonicalProfile || profiles.every(other => other.id === canonicalProfile.id);
    return {
        ...message,
        ...(author && { assistant_profile: author }),
        ...(message.llm == null && compatible && agreedModel && { llm: model }),
    };
}
