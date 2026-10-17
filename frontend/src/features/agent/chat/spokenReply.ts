import type { StoredChatMessage } from './sessionModel';

/** Unrelated system/user messages must not give an old assistant reply a new identity. */
export function spokenReply(messages: readonly StoredChatMessage[]): { text: string; key: string } {
  const index = messages.reduce((last, message, current) => message.role === 'assistant' ? current : last, -1);
  const message = messages[index];
  if (!message) return { text: '', key: '' };
  const turn = typeof message.turnId === 'string' && message.turnId ? message.turnId : undefined;
  const id = typeof message.id === 'string' && message.id ? message.id : undefined;
  return { text: message.content, key: turn ? `turn:${turn}` : id ? `message:${id}` : `legacy:${String(index)}` };
}
