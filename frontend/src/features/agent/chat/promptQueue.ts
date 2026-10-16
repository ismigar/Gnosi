import { defineStorageKey, readStorageResult, stringStorageCodec, writeStorage } from '../../../shared/platform/browser-storage';
import type { AgentChatMention } from '../model/agentChatMentionUtils';
import type { ChatAttachment } from './composerModel';

export interface QueuedPrompt {
  readonly id: string;
  readonly text: string;
  readonly attachments: readonly ChatAttachment[];
  readonly mentions: readonly AgentChatMention[];
  readonly profileId: string;
  readonly status: 'pending' | 'sending' | 'paused' | 'uncertain';
}
export function queueStorageKey(scope: string): string { return `agent_prompt_queue_v1:${scope}`; }
export function restorePromptQueue(scope: string, requireReview = true): QueuedPrompt[] {
  try {
    const stored = readStorageResult(defineStorageKey(queueStorageKey(scope), stringStorageCodec));
    if (!stored.ok) throw new Error('Prompt queue could not be read');
    const value: unknown = JSON.parse(stored.value || '[]');
    if (!Array.isArray(value)) return [];
    const items: unknown[] = value;
    return items.filter((item): item is QueuedPrompt => item !== null && typeof item === 'object' && 'id' in item && 'text' in item && 'profileId' in item && 'attachments' in item && 'mentions' in item && 'status' in item
      && typeof item.id === 'string' && typeof item.text === 'string' && typeof item.profileId === 'string'
      && Array.isArray(item.attachments) && item.attachments.every((file: unknown) => file !== null && typeof file === 'object'
        && 'id' in file && typeof file.id === 'string' && 'name' in file && typeof file.name === 'string'
        && 'size' in file && typeof file.size === 'number' && 'type' in file && typeof file.type === 'string'
        && 'path' in file && (file.path === null || typeof file.path === 'string') && 'url' in file && (file.url === null || typeof file.url === 'string'))
      && Array.isArray(item.mentions) && item.mentions.every((mention: unknown) => mention !== null && typeof mention === 'object'
        && 'id' in mention && typeof mention.id === 'string' && 'label' in mention && typeof mention.label === 'string'
        && 'type' in mention && ['page', 'table', 'database'].includes(String(mention.type)))
      && ['pending', 'sending', 'paused', 'uncertain'].includes(String(item.status))).slice(0, 100)
      // A restored queue requires explicit review. The browser may have closed after delivery.
      .map(item => ({ ...item, status: requireReview ? (item.status === 'sending' || item.status === 'uncertain' ? 'uncertain' : 'paused') : item.status }));
  } catch { return []; }
}
export function persistPromptQueue(scope: string, items: readonly QueuedPrompt[]): boolean {
  return writeStorage(defineStorageKey(queueStorageKey(scope), stringStorageCodec), JSON.stringify(items));
}
export function moveQueuedPrompt(items: readonly QueuedPrompt[], id: string, delta: number): QueuedPrompt[] {
  const next = [...items];
  const index = next.findIndex(item => item.id === id);
  const target = index + delta;
  const sourceItem = next[index];
  const targetItem = next[target];
  if (!sourceItem || !targetItem || sourceItem.status === 'sending' || targetItem.status === 'sending') return next;
  next[index] = targetItem; next[target] = sourceItem;
  return next;
}

/** All browser panels mutate the latest durable snapshot under the same origin lock. */
export async function mutatePromptQueue(scope: string, mutate: (items: readonly QueuedPrompt[]) => readonly QueuedPrompt[]): Promise<readonly QueuedPrompt[]> {
  const locks = (navigator as { locks?: LockManager }).locks;
  if (!locks) throw new Error('Prompt queue coordination is unavailable');
  return locks.request(`gnosi-prompt-write:${scope}`, () => {
    const readable = readStorageResult(defineStorageKey(queueStorageKey(scope), stringStorageCodec));
    if (!readable.ok) throw new Error('Prompt queue could not be read');
    const next = mutate(restorePromptQueue(scope, false));
    if (!persistPromptQueue(scope, next)) throw new Error('Prompt queue persistence failed');
    return next;
  });
}

export interface QueueDraftSnapshot {
  readonly inputValue: string;
  readonly attachments: readonly ChatAttachment[];
  readonly selectedMentions: readonly AgentChatMention[];
}
/** A completed durable enqueue must never clear a newer composer draft. */
export function queuedDraftStillCurrent(capturedScope: string, currentScope: string, captured: QueueDraftSnapshot,
  current: QueueDraftSnapshot, liveText?: string): boolean {
  return capturedScope === currentScope && captured.inputValue === current.inputValue
    && captured.attachments === current.attachments && captured.selectedMentions === current.selectedMentions
    && (liveText === undefined || liveText === captured.inputValue);
}
