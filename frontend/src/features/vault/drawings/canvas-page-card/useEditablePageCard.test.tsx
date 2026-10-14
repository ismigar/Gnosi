import { dispatchWindowEvent } from '../../../../shared/platform/browser-events';
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiTestStorage, writeApiTestStorage } from '../../../../../tests/api-request';
import { currentRequestContext } from '../../../../shared/api/request-context';
import { useEditablePageCard } from './useEditablePageCard';
import { pageCardDraftKey, updatePageCardState } from './pageCardDraftStore';

const mocks = vi.hoisted(() => ({ fetchPage: vi.fn(), patchPage: vi.fn() }));
vi.mock('../../../../shared/api/vaults', () => ({ fetchVaultPage: mocks.fetchPage, patchVaultPage: mocks.patchPage }));
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let root: Root;
let host: HTMLDivElement;
let card: ReturnType<typeof useEditablePageCard>;
let counter = 0;
let pageId: string;
const draftKeys = new Set<string>();
function Probe({ mounted = true }: { mounted?: boolean }) { return mounted ? <Card /> : null; }
function Card() {
    const current = useEditablePageCard(pageId);
    useLayoutEffect(() => { card = current; }, [current]);
    return <output>{current.editing ? current.draft : current.page?.content}</output>;
}
async function render(mounted = true) {
    draftKeys.add(pageCardDraftKey(currentRequestContext(), pageId));
    await act(async () => { root.render(<Probe mounted={mounted} />); await Promise.resolve(); });
}
beforeEach(() => {
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    pageId = `draft-fixture-${String(++counter)}`;
    for (const [key, value] of Object.entries({ gnosi_active_vault: 'vault', gnosi_workspace_id: 'workspace-a', gnosi_user_id: 'user-a', gnosi_user_email: 'a@example.invalid' })) writeApiTestStorage(key, value);
    mocks.fetchPage.mockResolvedValue({ content: 'Stored source', title: 'Page', etag: 'original-revision' });
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => {
    act(() => { root.unmount(); });
    for (const key of draftKeys) updatePageCardState(key, previous => ({ ...previous, editing: false, saving: false }));
    draftKeys.clear(); host.remove(); resetApiTestStorage(); delete testGlobal.IS_REACT_ACT_ENVIRONMENT;
});

describe('canvas draft lifecycle', () => {
    it('retains the original draft and ETag after a drawing unmount/remount, without saving implicitly', async () => {
        await render();
        act(() => { card.begin(); card.setDraft('Unsaved canvas draft'); });
        await render(false);
        const unload = new Event('beforeunload', { cancelable: true });
        dispatchWindowEvent(unload);
        expect(unload.defaultPrevented).toBe(true);
        mocks.fetchPage.mockResolvedValue({ content: 'External replacement', title: 'Page', etag: 'new-revision' });
        await render();
        act(() => { card.begin(); });
        expect(card.draft).toBe('Unsaved canvas draft');
        expect(card.page?.etag).toBe('original-revision');
        expect(mocks.patchPage).not.toHaveBeenCalled();
        mocks.patchPage.mockResolvedValueOnce({ etag: 'saved-revision' });
        await act(async () => { await card.save(); });
        expect(mocks.patchPage).toHaveBeenCalledWith(pageId, { content: 'Unsaved canvas draft', expected_etag: 'original-revision' }, expect.objectContaining({ context: currentRequestContext(), signal: expect.any(AbortSignal) as unknown }));
        expect(card.editing).toBe(false);
        const cleanUnload = new Event('beforeunload', { cancelable: true });
        dispatchWindowEvent(cleanUnload);
        expect(cleanUnload.defaultPrevented).toBe(false);
    });
    it.each(['gnosi_workspace_id', 'gnosi_user_id', 'gnosi_user_email', 'gnosi_active_vault'])('isolates drafts when %s changes and restores them only on return', async key => {
        await render();
        act(() => { card.begin(); card.setDraft('Scope A draft'); });
        const old = currentRequestContext();
        writeApiTestStorage(key, 'scope-b');
        await render();
        expect(card.editing).toBe(false);
        expect(host.textContent).not.toContain('Scope A draft');
        const mapping = { gnosi_workspace_id: old.workspaceId, gnosi_user_id: old.userId, gnosi_user_email: old.userEmail, gnosi_active_vault: old.vaultId };
        writeApiTestStorage(key, mapping[key as keyof typeof mapping]);
        await render();
        expect(card.draft).toBe('Scope A draft');
        expect(card.editing).toBe(true);
    });
    it('does not discard edits made while the cancellation reload is pending', async () => {
        await render(); act(() => { card.begin(); card.setDraft('First draft'); });
        let finish: (value: unknown) => void = () => undefined;
        mocks.fetchPage.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const pending = card.cancel();
        act(() => { card.setDraft('Newer draft'); });
        await act(async () => { finish({ content: 'Reloaded', etag: 'later' }); await pending; });
        expect(card.draft).toBe('Newer draft');
        expect(card.editing).toBe(true);
    });
    it('cancels a pending discard when its drawing unmounts and retains the draft', async () => {
        await render(); act(() => { card.begin(); card.setDraft('Keep after leaving'); });
        let finish: (value: unknown) => void = () => undefined;
        mocks.fetchPage.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const pending = card.cancel();
        await render(false);
        await act(async () => { finish({ content: 'Reloaded', etag: 'later' }); await pending; });
        await render();
        expect(card.draft).toBe('Keep after leaving');
        expect(card.editing).toBe(true);
    });
    it('finishes an explicit save after unmount without leaving a stale draft on remount', async () => {
        await render(); act(() => { card.begin(); card.setDraft('Submitted'); });
        let finish: (value: unknown) => void = () => undefined;
        mocks.patchPage.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        let pending: Promise<void> = Promise.resolve();
        act(() => { pending = card.save(); });
        await render(false);
        await act(async () => { finish({ etag: 'saved' }); await pending; });
        mocks.fetchPage.mockResolvedValue({ content: 'Submitted', title: 'Page', etag: 'saved' });
        await render();
        expect(card.editing).toBe(false);
        expect(card.page?.content).toBe('Submitted');
    });
    it('keeps a draft after a save is aborted by a scope change', async () => {
        await render(); act(() => { card.begin(); card.setDraft('Private draft'); });
        mocks.patchPage.mockImplementationOnce((_id, _input, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); });
        }));
        let pending: Promise<void> = Promise.resolve();
        act(() => { pending = card.save(); });
        writeApiTestStorage('gnosi_user_id', 'user-b');
        await act(async () => { dispatchWindowEvent(new Event('focus')); await pending; });
        await render();
        expect(host.textContent).not.toContain('Private draft');
        writeApiTestStorage('gnosi_user_id', 'user-a');
        await render();
        expect(card.draft).toBe('Private draft');
        expect(card.saving).toBe(false);
    });
});
