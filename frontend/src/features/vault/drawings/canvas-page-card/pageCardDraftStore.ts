import type { RequestContext } from '../../../../shared/api/request-context';
import { subscribeWindowEvent } from '../../../../shared/platform/browser-events';

export interface PageCardSnapshot {
    readonly content: string;
    readonly title: string;
    readonly etag: string | null;
}
export interface PageCardDraftState {
    readonly page: PageCardSnapshot | null;
    readonly draft: string;
    readonly editing: boolean;
    readonly saving: boolean;
    readonly error: 'load' | 'save' | 'conflict' | null;
    readonly revision: number;
}
const states = new Map<string, PageCardDraftState>();
const listeners = new Map<string, Set<() => void>>();
let dirtyCount = 0;
let stopUnloadGuard: (() => void) | undefined;

export function pageCardScopeKey(scope: RequestContext): string {
    return JSON.stringify([scope.userId, scope.userEmail, scope.vaultId, scope.workspaceId]);
}
export function pageCardDraftKey(scope: RequestContext, pageId: string): string {
    return JSON.stringify([pageCardScopeKey(scope), pageId]);
}
export function pageCardState(key: string): PageCardDraftState {
    const existing = states.get(key);
    if (existing) return existing;
    const initial: PageCardDraftState = { page: null, draft: '', editing: false, saving: false, error: null, revision: 0 };
    states.set(key, initial);
    return initial;
}

/** Drafts outlive a drawing's mounted editor, without storing note text on disk. */
export function updatePageCardState(key: string, update: (state: PageCardDraftState) => PageCardDraftState): void {
    const previous = pageCardState(key);
    const next = update(previous);
    if (next === previous) return;
    states.set(key, next);
    dirtyCount += Number(next.editing) - Number(previous.editing);
    if (dirtyCount > 0 && !stopUnloadGuard) {
        stopUnloadGuard = subscribeWindowEvent('beforeunload', event => { event.preventDefault(); });
    } else if (dirtyCount === 0 && stopUnloadGuard) {
        stopUnloadGuard();
        stopUnloadGuard = undefined;
    }
    for (const listener of listeners.get(key) ?? []) listener();
}
export function subscribePageCardState(key: string, listener: () => void): () => void {
    const subscribers = listeners.get(key) ?? new Set();
    subscribers.add(listener);
    listeners.set(key, subscribers);
    return () => {
        subscribers.delete(listener);
        if (subscribers.size > 0) return;
        listeners.delete(key);
        const state = states.get(key);
        if (!state?.editing && !state?.saving) states.delete(key);
    };
}
