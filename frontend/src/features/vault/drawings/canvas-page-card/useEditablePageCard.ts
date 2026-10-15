import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { fetchVaultPage, patchVaultPage, type VaultPage } from '../../../../shared/api/vaults';
import { GnosiApiError } from '../../../../shared/api/errors';
import { currentRequestContext } from '../../../../shared/api/request-context';
import { useRequestContext } from '../../../../shared/hooks/useRequestContext';
import { subscribeAppEvent } from '../../../../shared/platform/app-events';
import { subscribeWindowEvent } from '../../../../shared/platform/browser-events';
import { pageCardDraftKey, pageCardScopeKey, pageCardState, subscribePageCardState, updatePageCardState, type PageCardSnapshot } from './pageCardDraftStore';

function pageSnapshot(page: VaultPage): PageCardSnapshot {
    return { content: page.content, title: typeof page.title === 'string' ? page.title : '', etag: page.etag || null };
}

/** Every draft and pending write belongs to its captured account/workspace/Vault. */
export function useEditablePageCard(pageId: string) {
    const scope = useRequestContext();
    const scopeKey = pageCardScopeKey(scope);
    const key = pageCardDraftKey(scope, pageId);
    const state = useSyncExternalStore(
        useCallback(listener => subscribePageCardState(key, listener), [key]),
        useCallback(() => pageCardState(key), [key]),
    );
    const currentKey = useRef(key);
    const lifecycle = useRef({ active: true });
    const cancelRequest = useRef<AbortController | null>(null);
    const scopeIsCurrent = useCallback(() => pageCardScopeKey(currentRequestContext()) === scopeKey, [scopeKey]);

    useEffect(() => {
        currentKey.current = key;
        const life = { active: true };
        lifecycle.current = life;
        let controller: AbortController | null = null;
        const refresh = () => {
            if (pageCardState(key).editing || !pageId || !scopeIsCurrent()) return;
            controller?.abort();
            controller = new AbortController();
            const request = controller;
            void fetchVaultPage(pageId, request.signal, scope).then(next => {
                if (!life.active || request.signal.aborted || !scopeIsCurrent()) return;
                updatePageCardState(key, previous => previous.editing ? previous : { ...previous, page: pageSnapshot(next), error: null });
            }).catch(() => {
                if (life.active && !request.signal.aborted && scopeIsCurrent()) {
                    updatePageCardState(key, previous => previous.editing ? previous : { ...previous, error: 'load' });
                }
            });
        };
        refresh();
        const stopInvalidation = subscribeAppEvent('gnosi:invalidatePreview', detail => {
            if (!detail.pageId || detail.pageId === pageId) refresh();
        });
        const stopFocus = subscribeWindowEvent('focus', refresh);
        const timer = window.setInterval(refresh, 15_000);
        const cancellation = cancelRequest;
        return () => {
            life.active = false;
            controller?.abort();
            cancellation.current?.abort();
            stopInvalidation();
            stopFocus();
            window.clearInterval(timer);
        };
    }, [key, pageId, scope, scopeIsCurrent]);

    const begin = () => {
        if (!scopeIsCurrent()) return;
        updatePageCardState(key, previous => !previous.page?.etag || previous.editing ? previous
            : { ...previous, draft: previous.page.content, editing: true, error: null, revision: previous.revision + 1 });
    };
    const setDraft = (draft: string) => {
        if (!scopeIsCurrent()) return;
        cancelRequest.current?.abort();
        updatePageCardState(key, previous => !previous.editing ? previous
            : { ...previous, draft, revision: previous.revision + 1 });
    };
    const cancel = async () => {
        const previous = pageCardState(key);
        if (previous.saving || !previous.editing || !scopeIsCurrent()) return;
        cancelRequest.current?.abort();
        const request = new AbortController();
        cancelRequest.current = request;
        const life = lifecycle.current;
        try {
            const next = await fetchVaultPage(pageId, request.signal, scope);
            if (!life.active || request.signal.aborted || !scopeIsCurrent() || currentKey.current !== key) return;
            updatePageCardState(key, current => current.revision !== previous.revision ? current
                : { ...current, page: pageSnapshot(next), draft: '', editing: false, error: null, revision: current.revision + 1 });
        } catch {
            if (life.active && !request.signal.aborted && scopeIsCurrent()) {
                updatePageCardState(key, current => ({ ...current, error: 'load' }));
            }
        }
    };
    const save = async () => {
        const submitted = pageCardState(key);
        if (!submitted.page?.etag || !submitted.editing || submitted.saving || !scopeIsCurrent()) return;
        cancelRequest.current?.abort();
        updatePageCardState(key, previous => ({ ...previous, saving: true, error: null }));
        const request = new AbortController();
        const checkScope = () => { if (!scopeIsCurrent()) request.abort(); };
        const stopVault = subscribeAppEvent('gnosi:vault-changed', checkScope);
        const stopStorage = subscribeWindowEvent('storage', checkScope);
        const stopFocus = subscribeWindowEvent('focus', checkScope);
        try {
            const result = await patchVaultPage(pageId, { content: submitted.draft, expected_etag: submitted.page.etag }, { context: scope, signal: request.signal });
            const page = { ...submitted.page, content: submitted.draft, etag: result.etag ?? submitted.page.etag };
            // Complete the original entry even if its drawing was unmounted; never touch another scope's draft.
            updatePageCardState(key, current => current.revision === submitted.revision
                ? { ...current, page, draft: '', editing: false, saving: false, error: null, revision: current.revision + 1 }
                : { ...current, page, saving: false });
        } catch (cause) {
            updatePageCardState(key, current => ({ ...current, saving: false, error: cause instanceof GnosiApiError && cause.status === 409 ? 'conflict' : 'save' }));
        } finally {
            stopVault();
            stopStorage();
            stopFocus();
        }
    };
    return { ...state, begin, setDraft, cancel, save };
}
