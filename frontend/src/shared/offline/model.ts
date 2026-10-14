import type { RequestContext } from '../api/request-context';

export interface OfflineScope extends RequestContext {
    readonly origin: string;
}

export interface RemoteNote {
    readonly id: string;
    readonly title: string;
    readonly content: string;
    readonly etag: string;
}

export interface OfflineNote {
    readonly id: string;
    readonly title: string;
    readonly baseContent: string;
    readonly baseEtag: string;
    readonly localContent: string;
    readonly savedAt: string;
    readonly conflict?: RemoteNote;
}

export interface OfflineCollection {
    readonly version: 1;
    readonly scope: OfflineScope;
    readonly notes: readonly OfflineNote[];
}

export type OfflineErrorCode = 'unsupported' | 'passphrase' | 'unlock' | 'scope' | 'session'
    | 'storage' | 'changed' | 'locked' | 'network' | 'format' | 'limit' | 'etag' | 'missing' | 'unsaved';

export class OfflineError extends Error {
    constructor(readonly code: OfflineErrorCode) {
        super(`Offline collection: ${code}`);
        this.name = 'OfflineError';
    }
}

export const MAX_NOTE_LENGTH = 1_000_000;
export const MAX_COLLECTION_LENGTH = 12_000_000;
export const MAX_NOTES = 100;

export function sameScope(left: OfflineScope, right: OfflineScope): boolean {
    return left.origin === right.origin && left.userId === right.userId
        && left.userEmail === right.userEmail && left.workspaceId === right.workspaceId
        && left.vaultId === right.vaultId;
}

export function requireScope(scope: OfflineScope): void {
    if (!scope.userId || scope.userId === 'ismael-legacy' || !scope.userEmail
        || !scope.workspaceId || !scope.vaultId || !/^https?:\/\//u.test(scope.origin)) {
        throw new OfflineError('scope');
    }
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function boundedString(value: unknown, maximum = MAX_NOTE_LENGTH): value is string {
    return typeof value === 'string' && value.length <= maximum;
}
function validRemote(value: unknown): value is RemoteNote {
    return record(value) && boundedString(value.id, 1024) && Boolean(value.id)
        && boundedString(value.title, 4096) && boundedString(value.content)
        && boundedString(value.etag, 1024) && Boolean(value.etag);
}

export function parseCollection(raw: string): OfflineCollection {
    if (raw.length > MAX_COLLECTION_LENGTH) throw new OfflineError('limit');
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.version !== 1 || !record(value.scope)
        || !['origin', 'userId', 'userEmail', 'workspaceId', 'vaultId'].every(key =>
            boundedString((value.scope as Record<string, unknown>)[key], 2048))
        || !Array.isArray(value.notes) || value.notes.length > MAX_NOTES) throw new OfflineError('unlock');
    const ids = new Set<string>();
    for (const note of value.notes) {
        if (!record(note) || !boundedString(note.id, 1024) || !note.id || ids.has(note.id)
            || !boundedString(note.title, 4096) || !boundedString(note.baseContent)
            || !boundedString(note.localContent) || !boundedString(note.baseEtag, 1024) || !note.baseEtag
            || !boundedString(note.savedAt, 128)
            || (note.conflict !== undefined && (!validRemote(note.conflict) || note.conflict.id !== note.id))) {
            throw new OfflineError('unlock');
        }
        ids.add(note.id);
    }
    const collection = value as unknown as OfflineCollection;
    requireScope(collection.scope);
    return collection;
}

export function cachedNote(remote: RemoteNote): OfflineNote {
    return { id: remote.id, title: remote.title, baseContent: remote.content, baseEtag: remote.etag,
        localContent: remote.content, savedAt: new Date().toISOString() };
}

/** A changed server version is always shown before any locally changed note is sent. */
export function compareNote(note: OfflineNote, remote: RemoteNote): 'same' | 'download' | 'upload' | 'conflict' {
    if (note.localContent === remote.content) return 'download';
    if (note.localContent === note.baseContent) return remote.etag === note.baseEtag ? 'same' : 'download';
    return remote.etag === note.baseEtag ? 'upload' : 'conflict';
}
