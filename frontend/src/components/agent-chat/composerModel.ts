import type { AgentChatMention } from '../agentChatMentionUtils';
import { visibleMentionToken } from '../agentChatMentionUtils';
import { isRecord, stringifyLooseValue } from '../agentChatMessageTypes';

export const MAX_CHAT_ATTACHMENT_SIZE = 15 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENTS = 8;
export const CHAT_ATTACHMENT_ACCEPT = ['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.py', '.pdf'].join(',');
export interface ChatAttachment {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly path: string | null;
  readonly url: string | null;
}
export interface CatalogMention extends AgentChatMention {
  readonly search: string;
  readonly subtitle: string;
}
export interface MentionMenuState {
  readonly anchor: number;
  readonly results: CatalogMention[];
  readonly open: boolean;
}
export type MentionMenuAction = { readonly type: 'query'; readonly value: MentionMenuState } | { readonly type: 'open'; readonly value: boolean } | { readonly type: 'clear' };
export const EMPTY_MENTION_MENU: MentionMenuState = { anchor: -1, results: [], open: false };
export function mentionMenuReducer(state: MentionMenuState, action: MentionMenuAction): MentionMenuState {
  if (action.type === 'clear') return EMPTY_MENTION_MENU;
  if (action.type === 'open') return { ...state, open: action.value };
  return action.value;
}

export function catalogMentions(value: unknown, type: 'page' | 'table' | 'database', subtitle: string): CatalogMention[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => {
    const label = stringifyLooseValue((type === 'page' ? item.title || item.name : item.name || item.title) || item.id);
    const id = stringifyLooseValue(item.id);
    return { id, type, label, subtitle, search: `${type === 'database' ? 'database bd' : type} ${label} ${id}`.toLowerCase() };
  });
}

export function queryMentionMenu(value: string, caret: number, catalog: readonly CatalogMention[]): MentionMenuState {
  const match = value.slice(0, caret).match(/(?:^|\s)@([^\s@]{0,40})$/);
  if (!match) return EMPTY_MENTION_MENU;
  const query = (match[1] || '').toLowerCase();
  const results = catalog.filter((item) => item.search.includes(query)).slice(0, 8);
  return { anchor: caret - query.length - 1, results, open: results.length > 0 };
}

export function insertChatMention(value: string, caret: number, anchor: number, item: CatalogMention): { value: string; caret: number; mention: AgentChatMention } | null {
  if (anchor < 0 || anchor > caret) return null;
  const token = `${visibleMentionToken(item.label)} `;
  const before = value.slice(0, anchor);
  return { value: `${before}${token}${value.slice(caret)}`, caret: before.length + token.length, mention: { type: item.type, id: item.id, label: item.label, token: token.trim() } };
}

export function pickChatAttachments(files: readonly File[], existingCount: number): { valid: File[]; skipped: number } {
  const slots = Math.max(0, MAX_CHAT_ATTACHMENTS - existingCount);
  const valid = files.filter((file) => file.size <= MAX_CHAT_ATTACHMENT_SIZE).slice(0, slots);
  return { valid, skipped: files.length - valid.length };
}
