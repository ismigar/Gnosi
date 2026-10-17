import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAt, resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { deleteVaultBookmark, fetchVaultBookmarks, importVaultBookmarks, reorderVaultBookmarks, saveVaultBookmark, setVaultPageBookmark, setVaultRouteBookmark, sortVaultBookmarks } from './bookmarks';

const context = { vaultId: 'vault-a', workspaceId: 'workspace', userId: 'reader', userEmail: 'reader@example.test' };
const entry = { id: 'one', label: 'My note', group: 'Study', kind: 'page' as const, target: 'note', created_at: 12 };
const collection = { entries: [entry], sort_mode: 'manual' };

function enterScope() {
  writeApiTestStorage('gnosi_active_vault', context.vaultId);
  writeApiTestStorage('gnosi_workspace_id', context.workspaceId);
  writeApiTestStorage('gnosi_user_id', context.userId);
  writeApiTestStorage('gnosi_user_email', context.userEmail);
}
afterEach(() => { resetApiTestStorage(); vi.unstubAllGlobals(); });

describe('canonical bookmark API', () => {
  it('pins every read/write to its captured identity and strips read-only timestamps', async () => {
    enterScope();
    const mock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(Response.json(collection)));
    vi.stubGlobal('fetch', mock);
    await fetchVaultBookmarks(context);
    await importVaultBookmarks({ entries: [entry], sort_mode: 'alpha-asc', page_order: ['note'] }, context);
    await saveVaultBookmark(entry, context);
    await deleteVaultBookmark(entry.id, context);
    await reorderVaultBookmarks(['one'], context);
    await sortVaultBookmarks('recent', context);
    await setVaultPageBookmark('note', 'My note', false, context);
    await setVaultRouteBookmark('/knowledge/table/t/view/v', 'Table view', true, context);
    expect(mock).toHaveBeenCalledTimes(8);
    for (let index = 0; index < 8; index++) {
      const req = requestAt(mock.mock.calls, index);
      expect(req.headers.get('X-Vault-ID')).toBe('vault-a');
      expect(req.headers.get('X-Workspace-ID')).toBe('workspace');
      expect(req.headers.get('X-User-ID')).toBe('reader');
      expect(req.headers.get('X-User-Email')).toBe('reader@example.test');
    }
    expect(await requestAt(mock.mock.calls, 2).json()).toEqual({ id: 'one', label: 'My note', group: 'Study', kind: 'page', target: 'note' });
    expect(await requestAt(mock.mock.calls, 6).json()).toEqual({ label: 'My note', enabled: false });
    expect(await requestAt(mock.mock.calls, 7).json()).toEqual({ label: 'Table view', target: '/knowledge/table/t/view/v', enabled: true });
  });
  it.each(['gnosi_active_vault', 'gnosi_workspace_id', 'gnosi_user_id', 'gnosi_user_email'])(
    'rejects all old-scope writes after %s changes', async key => {
      enterScope();
      writeApiTestStorage(key, 'other');
      const mock = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', mock);
      for (const operation of [() => saveVaultBookmark(entry, context), () => deleteVaultBookmark('one', context),
        () => setVaultPageBookmark('note', 'My note', true, context), () => reorderVaultBookmarks(['one'], context),
        () => setVaultRouteBookmark('/knowledge/drawing/one', 'Canvas', true, context),
        () => sortVaultBookmarks('oldest', context), () => importVaultBookmarks({ entries: [] }, context)]) {
        await expect(operation()).rejects.toMatchObject({ name: 'AbortError' });
      }
      expect(mock).not.toHaveBeenCalled();
    },
  );
  it('propagates storage/auth failures rather than reporting a successful save', async () => {
    enterScope();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ detail: 'Unavailable' }, { status: 503 })));
    await expect(saveVaultBookmark(entry, context)).rejects.toMatchObject({ status: 503 });
  });
});
