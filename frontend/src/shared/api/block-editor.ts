import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


type JsonRecord = Record<string, unknown>;


export interface BlockEditorBacklink {
  readonly id: string;
  readonly kind: 'link' | 'relation';
  readonly title: string;
}


export interface BlockEditorPageLink {
  readonly id: string;
  readonly title: string;
}


export interface BlockEditorUnresolvedLink {
  readonly title: string;
}


export interface BlockEditorOutlinks {
  readonly links: BlockEditorPageLink[];
  readonly relations: BlockEditorPageLink[];
  readonly unresolved: BlockEditorUnresolvedLink[];
}


export interface BlockEditorUnlinkedMention {
  readonly count: number;
  readonly id: string;
  readonly snippet: string;
  readonly title: string;
}


export interface BlockEditorLinkedMentionChange {
  readonly id: string;
  readonly replacements: number;
  readonly title: string;
}


export interface BlockEditorLinkMentionsResult {
  readonly changed_notes: BlockEditorLinkedMentionChange[];
  readonly notes_changed: number;
  readonly status: 'success';
  readonly target_id: string;
  readonly target_title: string;
  readonly total_replacements: number;
}


export type BlockEditorLinkMentionsInput =
  components['schemas']['LinkMentionsRequest'];


function requireRecord(value: unknown, context: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid ${context} response`);
  }
  return value as JsonRecord;
}


function requireArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`Invalid ${context} response`);
  return value;
}


function requireString(
  record: JsonRecord,
  key: string,
  context: string,
): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new TypeError(`Invalid ${context}.${key}`);
  }
  return value;
}


function requireNumber(
  record: JsonRecord,
  key: string,
  context: string,
): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Invalid ${context}.${key}`);
  }
  return value;
}


function parsePageLink(value: unknown, context: string): BlockEditorPageLink {
  const record = requireRecord(value, context);
  return {
    id: requireString(record, 'id', context),
    title: requireString(record, 'title', context),
  };
}


function parseBacklink(value: unknown): BlockEditorBacklink {
  const record = requireRecord(value, 'backlink');
  const kind = record.kind;
  if (kind !== 'link' && kind !== 'relation') {
    throw new TypeError('Invalid backlink.kind');
  }
  return {
    ...parsePageLink(record, 'backlink'),
    kind,
  };
}


function parseOutlinks(value: unknown): BlockEditorOutlinks {
  const record = requireRecord(value, 'outlinks');
  return {
    links: requireArray(record.links, 'outlinks.links').map((item) =>
      parsePageLink(item, 'outlinks.links item'),
    ),
    relations: requireArray(record.relations, 'outlinks.relations').map(
      (item) => parsePageLink(item, 'outlinks.relations item'),
    ),
    unresolved: requireArray(record.unresolved, 'outlinks.unresolved').map(
      (item) => {
        const unresolved = requireRecord(item, 'outlinks.unresolved item');
        return {
          title: requireString(
            unresolved,
            'title',
            'outlinks.unresolved item',
          ),
        };
      },
    ),
  };
}


function parseUnlinkedMention(value: unknown): BlockEditorUnlinkedMention {
  const record = requireRecord(value, 'unlinked mention');
  return {
    count: requireNumber(record, 'count', 'unlinked mention'),
    id: requireString(record, 'id', 'unlinked mention'),
    snippet: requireString(record, 'snippet', 'unlinked mention'),
    title: requireString(record, 'title', 'unlinked mention'),
  };
}


function parseLinkedMentionChange(
  value: unknown,
): BlockEditorLinkedMentionChange {
  const record = requireRecord(value, 'linked mention change');
  return {
    id: requireString(record, 'id', 'linked mention change'),
    replacements: requireNumber(record, 'replacements', 'linked mention change'),
    title: requireString(record, 'title', 'linked mention change'),
  };
}


function parseLinkMentionsResult(value: unknown): BlockEditorLinkMentionsResult {
  const record = requireRecord(value, 'link mentions');
  const status = requireString(record, 'status', 'link mentions');
  if (status !== 'success') throw new TypeError('Invalid link mentions.status');
  return {
    changed_notes: requireArray(
      record.changed_notes,
      'link mentions.changed_notes',
    ).map(parseLinkedMentionChange),
    notes_changed: requireNumber(record, 'notes_changed', 'link mentions'),
    status,
    target_id: requireString(record, 'target_id', 'link mentions'),
    target_title: requireString(record, 'target_title', 'link mentions'),
    total_replacements: requireNumber(
      record,
      'total_replacements',
      'link mentions',
    ),
  };
}


export async function fetchBlockEditorBacklinks(
  pageId: string,
  signal?: AbortSignal,
): Promise<BlockEditorBacklink[]> {
  const payload = unwrapApiResult<unknown, unknown>(
    await apiClient.GET('/api/vault/backlinks', {
      params: { query: { id: pageId } },
      signal,
    }),
  );
  return requireArray(payload, 'backlinks').map(parseBacklink);
}


export async function fetchBlockEditorOutlinks(
  pageId: string,
  signal?: AbortSignal,
): Promise<BlockEditorOutlinks> {
  const payload = unwrapApiResult<unknown, unknown>(
    await apiClient.GET('/api/vault/outlinks', {
      params: { query: { id: pageId } },
      signal,
    }),
  );
  return parseOutlinks(payload);
}


export async function fetchBlockEditorUnlinkedMentions(
  pageId: string,
  signal?: AbortSignal,
): Promise<BlockEditorUnlinkedMention[]> {
  const payload = unwrapApiResult<unknown, unknown>(
    await apiClient.GET('/api/vault/unlinked-mentions', {
      params: { query: { id: pageId } },
      signal,
    }),
  );
  return requireArray(payload, 'unlinked mentions').map(parseUnlinkedMention);
}


export async function linkBlockEditorUnlinkedMentions(
  input: BlockEditorLinkMentionsInput,
): Promise<BlockEditorLinkMentionsResult> {
  const payload = unwrapApiResult<unknown, unknown>(
    await apiClient.POST('/api/vault/link-unlinked-mentions', { body: input }),
  );
  return parseLinkMentionsResult(payload);
}
