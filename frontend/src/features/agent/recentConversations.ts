import { agentChatStorageScope, type AgentChatStorageIdentity } from './model/agentConfirmationUtils';
import { readChatStorage, scopedChatStorageKey } from './chat/chatPersistence';
import { CHAT_SESSIONS_KEY, MAX_STORED_SESSIONS } from './chat/sessionModel';
import { parseStoredSessions } from './chat/sessionRestore';

export interface ConversationSummary {
    readonly id: string;
    readonly title: string;
    readonly updatedAt: number;
}

/** The launcher stores private conversations on this device. Reading their titles never restores a chat. */
export function recentConversations(identity: AgentChatStorageIdentity): ConversationSummary[] {
    const raw = readChatStorage(scopedChatStorageKey(CHAT_SESSIONS_KEY, agentChatStorageScope(identity)));
    const values = parseStoredSessions(raw);
    if (!Array.isArray(values)) return [];
    return values.slice(0, MAX_STORED_SESSIONS).flatMap((value: unknown): ConversationSummary[] => {
        if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string'
            || !('title' in value) || typeof value.title !== 'string' || !('updatedAt' in value)
            || typeof value.updatedAt !== 'number' || !Number.isFinite(new Date(value.updatedAt).getTime())
            || !('messages' in value) || !Array.isArray(value.messages) || !value.messages.length) return [];
        return [{ id: value.id, title: value.title, updatedAt: value.updatedAt }];
    }).sort((left, right) => right.updatedAt - left.updatedAt);
}
