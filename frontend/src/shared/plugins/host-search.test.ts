import { dispatchWindowEvent } from '../platform/browser-events';
import { afterEach, expect, it, vi } from 'vitest';
import { HOST_METHODS } from './host-methods';
import { searchVaultContent } from '../api/vault-search';
import { currentRequestContext, VAULT_ID_STORAGE_KEY } from '../api/request-context';
import { writeStorage } from '../platform/browser-storage';
import { emitAppEvent } from '../platform/app-events';
import { resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
vi.mock('../api/vault-search', () => ({ searchVaultContent: vi.fn() }));
afterEach(() => { resetApiTestStorage(); vi.clearAllMocks(); });

it('uses the full-content API with the active vault and rejects malformed search arguments', async () => {
    const method = HOST_METHODS['vault.search'];
    if (!method) throw new Error('Missing search bridge');
    writeStorage(VAULT_ID_STORAGE_KEY, 'fixture');
    expect(method.perm).toBe('vault:read');
    vi.mocked(searchVaultContent).mockResolvedValue({} as Awaited<ReturnType<typeof searchVaultContent>>);
    await method.run({ query: 'content:phrase', offset: 50 }, 'plugin');
    expect(searchVaultContent).toHaveBeenCalledWith('content:phrase', expect.objectContaining({ offset: 50, context: currentRequestContext() }));
    expect(vi.mocked(searchVaultContent).mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    await expect(method.run({ query: 'x', offset: -1 }, 'plugin')).rejects.toThrow('offset');
    await expect(method.run({ query: 12 }, 'plugin')).rejects.toThrow('query');
    expect(searchVaultContent).toHaveBeenCalledTimes(1);
});

it('cancels and rejects in-flight results after the active vault changes', async () => {
    const method = HOST_METHODS['vault.search'];
    if (!method) throw new Error('Missing search bridge');
    let complete: ((value: Awaited<ReturnType<typeof searchVaultContent>>) => void) | undefined;
    vi.mocked(searchVaultContent).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    writeStorage(VAULT_ID_STORAGE_KEY, 'first');
    const pending = method.run({ query: 'needle' }, 'plugin');
    const rejected = expect(pending).rejects.toThrow('context changed');
    writeStorage(VAULT_ID_STORAGE_KEY, 'second');
    emitAppEvent('gnosi:vault-changed', { id: 'second', name: 'Second', slug: 'second' });
    expect(vi.mocked(searchVaultContent).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    complete?.({} as Awaited<ReturnType<typeof searchVaultContent>>);
    await rejected;
});

it.each(['gnosi_workspace_id', 'gnosi_user_id', 'gnosi_user_email'])(
    'pins the request and rejects an earlier %s scope even after switching back', async key => {
        const method = HOST_METHODS['vault.search'];
        if (!method) throw new Error('Missing search bridge');
        writeApiTestStorage(key, 'original');
        writeStorage(VAULT_ID_STORAGE_KEY, 'same-vault');
        const context = currentRequestContext();
        let complete: ((value: Awaited<ReturnType<typeof searchVaultContent>>) => void) | undefined;
        vi.mocked(searchVaultContent).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
        const pending = method.run({ query: 'private text' }, 'plugin');
        const rejected = expect(pending).rejects.toThrow('context changed');
        expect(searchVaultContent).toHaveBeenCalledWith('private text', expect.objectContaining({ context }));
        writeApiTestStorage(key, 'different');
        dispatchWindowEvent(new StorageEvent('storage', { key }));
        expect(vi.mocked(searchVaultContent).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
        writeApiTestStorage(key, 'original');
        dispatchWindowEvent(new Event('focus'));
        complete?.({} as Awaited<ReturnType<typeof searchVaultContent>>);
        await rejected;
    },
);

it('rejects a changed context at completion even without a browser event', async () => {
    const method = HOST_METHODS['vault.search'];
    if (!method) throw new Error('Missing search bridge');
    let complete: ((value: Awaited<ReturnType<typeof searchVaultContent>>) => void) | undefined;
    vi.mocked(searchVaultContent).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const pending = method.run({ query: 'private text' }, 'plugin');
    const rejected = expect(pending).rejects.toThrow('context changed');
    writeApiTestStorage('gnosi_user_id', 'different');
    complete?.({} as Awaited<ReturnType<typeof searchVaultContent>>);
    await rejected;
});
