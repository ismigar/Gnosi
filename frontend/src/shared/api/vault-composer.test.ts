import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { applyNoteComposition, previewNoteComposition, type ComposerPreview } from './vault-composer';
import { subscribeAppEvent } from '../platform/app-events';

afterEach(() => { resetApiTestStorage(); vi.unstubAllGlobals(); });
const context = { vaultId: 'vault', workspaceId: 'workspace', userId: 'user', userEmail: '' };
const preview: ComposerPreview = { request: { source_id: 'source', mode: 'extract', selection: 'note', heading: '', title: 'New', target_id: 'new' }, token: 'a'.repeat(64), changes: [], rewritten_links: 0 };

describe('Composer API', () => {
  it('pins preview/apply to the captured scope and submits exactly the reviewed token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(preview))
      .mockResolvedValueOnce(Response.json({ source_id: 'source', target_id: 'new', changes: [] }));
    vi.stubGlobal('fetch', fetchMock);
    writeApiTestStorage('gnosi_active_vault', 'other');
    const controller = new AbortController();
    await previewNoteComposition(preview.request, context, controller.signal);
    writeApiTestStorage('gnosi_active_vault', 'vault'); writeApiTestStorage('gnosi_workspace_id', 'workspace'); writeApiTestStorage('gnosi_user_id', 'user');
    await applyNoteComposition(preview, context);
    for (let index = 0; index < 2; index += 1) {
      const req = requestAt(fetchMock.mock.calls, index);
      expect(req.headers.get('X-Vault-ID')).toBe('vault');
      expect(req.headers.get('X-Workspace-ID')).toBe('workspace');
    }
    expect(await requestAt(fetchMock.mock.calls, 1).json()).toEqual({ request: preview.request, token: preview.token });
    controller.abort();
    expect(requestAt(fetchMock.mock.calls, 0).signal.aborted).toBe(true);
  });
  it('emits preview invalidation only for a successful response in the same scope', async () => {
    writeApiTestStorage('gnosi_active_vault', 'vault'); writeApiTestStorage('gnosi_workspace_id', 'workspace'); writeApiTestStorage('gnosi_user_id', 'user');
    const invalidate = vi.fn(); const unsubscribe = subscribeAppEvent('gnosi:invalidatePreview', invalidate);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ source_id: 'source', target_id: 'new', changes: [{ id: 'source' }, { id: 'new' }] }))
      .mockResolvedValueOnce(Response.json({ detail: 'Changed' }, { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    await applyNoteComposition(preview, context);
    expect(invalidate).toHaveBeenCalledTimes(2);
    await expect(applyNoteComposition(preview, context)).rejects.toMatchObject({ status: 409 });
    expect(invalidate).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
  it.each(['gnosi_active_vault', 'gnosi_workspace_id', 'gnosi_user_id', 'gnosi_user_email'])(
    'does not submit the reviewed mutation after %s changes', async key => {
      writeApiTestStorage('gnosi_active_vault', 'vault'); writeApiTestStorage('gnosi_workspace_id', 'workspace'); writeApiTestStorage('gnosi_user_id', 'user');
      writeApiTestStorage(key, 'different');
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);
      await expect(applyNoteComposition(preview, context)).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
