// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { OfflineRemote } from '../api/offline-sync';
import { GnosiApiError } from '../api/errors';
import { OfflineController } from './controller';
import { decryptCollection, deriveKey, encryptCollection, newSalt, type EncryptedCollection } from './crypto';
import { cachedNote, OfflineError, type OfflineCollection, type OfflineScope } from './model';
import type { OfflineStore } from './storage';

const scope: OfflineScope = { origin: 'https://gnosi.example.invalid', userId: 'account-a', userEmail: 'a@example.invalid', workspaceId: 'workspace-a', vaultId: 'vault-a' };
const remoteNote = { id: 'note-a', title: 'Private title', content: '# Original secret', etag: 'v1' };
const collection: OfflineCollection = { version: 1, scope, notes: [cachedNote(remoteNote)] };
function required<T>(value: T | null | undefined): T {
    if (value == null) throw new Error('Missing fixture value');
    return value;
}
const passphrase = 'a separate private passphrase';
let initial: EncryptedCollection;
let cryptoKey: CryptoKey;
beforeAll(async () => {
    vi.stubGlobal('crypto', webcrypto);
    const salt = newSalt();
    cryptoKey = await deriveKey(passphrase, salt);
    initial = await encryptCollection(collection, cryptoKey, salt, 1);
});

class MemoryStore implements OfflineStore {
    value: EncryptedCollection | null = structuredClone(initial);
    read = vi.fn(() => Promise.resolve(structuredClone(this.value)));
    write = vi.fn((next: EncryptedCollection, expected: number) => {
        if ((this.value?.revision ?? 0) !== expected) return Promise.reject(new OfflineError('changed'));
        this.value = structuredClone(next);
        return Promise.resolve();
    });
    remove = vi.fn((expected: number) => {
        if (this.value?.revision !== expected) return Promise.reject(new OfflineError('changed'));
        this.value = null;
        return Promise.resolve();
    });
}

function setup() {
    const store = new MemoryStore();
    let currentScope = { ...scope };
    const remote = {
        verify: vi.fn<OfflineRemote['verify']>().mockResolvedValue(undefined),
        list: vi.fn<OfflineRemote['list']>().mockResolvedValue([{ id: remoteNote.id, title: remoteNote.title }]),
        read: vi.fn<OfflineRemote['read']>().mockResolvedValue(remoteNote),
        write: vi.fn<OfflineRemote['write']>().mockImplementation((_scope, id, content) => Promise.resolve({ ...remoteNote, id, content, etag: 'v2' })),
    };
    const controller = new OfflineController(store, remote, () => currentScope);
    return { controller, store, remote, switchScope: () => { currentScope = { ...scope, userId: 'account-b' }; } };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

async function editLocally(controller: OfflineController) {
    await controller.unlock(passphrase);
    controller.edit('note-a', '# Local secret');
    await controller.saveLocal('note-a');
}

it('encrypts private scope, titles and content; authenticates ciphertext, revision and passphrase', async () => {
    expect(cryptoKey.extractable).toBe(false);
    const serialized = JSON.stringify(initial);
    for (const secret of ['Private title', 'Original secret', 'account-a', 'vault-a', passphrase]) expect(serialized).not.toContain(secret);
    expect(await decryptCollection(initial, cryptoKey)).toEqual(collection);
    await expect(decryptCollection({ ...initial, revision: 2 }, cryptoKey)).rejects.toMatchObject({ code: 'unlock' });
    const wrong = await deriveKey('different correct length passphrase', initial.salt);
    await expect(decryptCollection(initial, wrong)).rejects.toMatchObject({ code: 'unlock' });
    const changed = { ...initial, data: initial.data.slice(0, -4) + 'AAAA' };
    await expect(decryptCollection(changed, cryptoKey)).rejects.toMatchObject({ code: 'unlock' });
});

it('retains explicitly saved edits across a fresh offline controller, without network boot', async () => {
    const { controller, remote, store } = setup();
    await controller.initialize();
    expect(controller.getSnapshot().collection).toBeNull();
    await editLocally(controller);
    expect(controller.getSnapshot().notice).toBe('saved');
    controller.lock();
    expect(controller.getSnapshot()).toMatchObject({ collection: null, drafts: {}, choices: [] });
    const restarted = new OfflineController(store, remote, () => scope);
    await restarted.unlock(passphrase);
    expect(restarted.getSnapshot().collection?.notes[0]?.localContent).toBe('# Local secret');
    expect(remote.verify).not.toHaveBeenCalled();
    expect(remote.read).not.toHaveBeenCalled();
});

it('preserves unsaved drafts when sync is requested before local save', async () => {
    const { controller, remote } = setup();
    await controller.unlock(passphrase);
    controller.edit('note-a', 'Unsaved');
    await controller.sync('note-a');
    expect(controller.getSnapshot().error).toBe('unsaved');
    expect(controller.getSnapshot().drafts['note-a']).toBe('Unsaved');
    expect(remote.verify).not.toHaveBeenCalled();
});

it('tracks unsaved merge work without persisting it and refuses an implicit sync', async () => {
    const { controller, remote, store } = setup();
    await editLocally(controller);
    remote.read.mockResolvedValue({ ...remoteNote, content: 'Server2', etag: 'server2' });
    await controller.sync('note-a');
    const encrypted = structuredClone(store.value);
    controller.editMerge('note-a', '# Unsaved merge');
    expect(controller.hasDrafts()).toBe(true);
    expect(controller.getSnapshot().mergeDrafts['note-a']).toBe('# Unsaved merge');
    expect(store.value).toEqual(encrypted);
    await controller.sync('note-a');
    expect(controller.getSnapshot().error).toBe('unsaved');
    expect(controller.getSnapshot().mergeDrafts['note-a']).toBe('# Unsaved merge');
    expect(remote.write).not.toHaveBeenCalled();
    controller.editMerge('note-a', '# Local secret');
    expect(controller.hasDrafts()).toBe(false);
});

it.each(['lock', 'scope'] as const)('clears private merge drafts on %s invalidation', async reason => {
    const { controller, remote, switchScope } = setup();
    await editLocally(controller);
    remote.read.mockResolvedValue({ ...remoteNote, content: 'Server2', etag: 'server2' });
    await controller.sync('note-a');
    controller.editMerge('note-a', '# Unsaved private merge');
    if (reason === 'scope') { switchScope(); controller.checkScope(); }
    else controller.lock();
    expect(controller.getSnapshot()).toMatchObject({ collection: null, drafts: {}, mergeDrafts: {}, choices: [] });
    expect(controller.hasDrafts()).toBe(false);
    expect(remote.write).not.toHaveBeenCalled();
    if (reason === 'lock') {
        await controller.unlock(passphrase);
        expect(controller.getSnapshot().collection?.notes[0]?.localContent).toBe('# Local secret');
        expect(controller.getSnapshot().mergeDrafts).toEqual({});
    }
});

it('keeps a merge draft when its explicit local checkpoint fails', async () => {
    const { controller, remote, store } = setup();
    await editLocally(controller);
    remote.read.mockResolvedValue({ ...remoteNote, content: 'Server2', etag: 'server2' });
    await controller.sync('note-a');
    controller.editMerge('note-a', '# Unsaved merge');
    store.write.mockRejectedValueOnce(new OfflineError('storage'));
    await controller.sync('note-a', { merged: '# Unsaved merge' });
    expect(controller.getSnapshot()).toMatchObject({ error: 'storage', mergeDrafts: { 'note-a': '# Unsaved merge' } });
    expect(controller.hasDrafts()).toBe(true);
    expect(remote.write).not.toHaveBeenCalled();
});

it('freezes draft input while an explicit merge is saving and clears only the saved proposal', async () => {
    const { controller, remote, store } = setup();
    await editLocally(controller);
    remote.read.mockResolvedValue({ ...remoteNote, content: 'Server2', etag: 'server2' });
    await controller.sync('note-a');
    controller.editMerge('note-a', '# Reviewed merge');
    const pending = deferred<typeof remoteNote>();
    remote.write.mockReturnValueOnce(pending.promise);
    const sync = controller.sync('note-a', { merged: '# Reviewed merge' });
    expect(controller.getSnapshot().busy).toBe(true);
    controller.editMerge('note-a', '# Edit attempted while disabled');
    await vi.waitFor(() => { expect(remote.write).toHaveBeenCalled(); });
    expect((await decryptCollection(required(store.value), cryptoKey)).notes[0]?.localContent).toBe('# Reviewed merge');
    expect(controller.getSnapshot().mergeDrafts).toEqual({});
    expect(remote.write).toHaveBeenCalledExactlyOnceWith(scope, 'note-a', '# Reviewed merge', 'server2', expect.any(AbortSignal));
    pending.resolve({ ...remoteNote, content: '# Reviewed merge', etag: 'server3' });
    await sync;
    expect(controller.getSnapshot().collection?.notes[0]?.localContent).toBe('# Reviewed merge');
    expect(controller.hasDrafts()).toBe(false);
});

it('uploads a local change only with the exact fetched ETag and pinned scope', async () => {
    const { controller, remote } = setup();
    await editLocally(controller);
    await controller.sync('note-a');
    expect(remote.write).toHaveBeenCalledExactlyOnceWith(scope, 'note-a', '# Local secret', 'v1', expect.any(AbortSignal));
    expect(controller.getSnapshot().collection?.notes[0]).toMatchObject({ baseEtag: 'v2', baseContent: '# Local secret', localContent: '# Local secret' });
});

it('shows both changes without writing, then accepts an explicit server choice', async () => {
    const { controller, remote } = setup();
    await editLocally(controller);
    remote.read.mockResolvedValue({ ...remoteNote, content: '# Server secret', etag: 'server2' });
    await controller.sync('note-a');
    expect(remote.write).not.toHaveBeenCalled();
    expect(controller.getSnapshot().collection?.notes[0]).toMatchObject({ localContent: '# Local secret', conflict: { content: '# Server secret' } });
    await controller.sync('note-a', 'server');
    expect(remote.write).not.toHaveBeenCalled();
    expect(controller.getSnapshot().collection?.notes[0]).toMatchObject({ localContent: '# Server secret', baseEtag: 'server2' });
    expect(controller.getSnapshot().collection?.notes[0]?.conflict).toBeUndefined();
});

it('persists a proposed merge locally and reopens review if the server changed after preview', async () => {
    const { controller, remote, store } = setup();
    await editLocally(controller);
    remote.read.mockResolvedValue({ ...remoteNote, content: 'Server2', etag: 'server2' });
    await controller.sync('note-a');
    remote.read.mockResolvedValue({ ...remoteNote, content: 'Server3', etag: 'server3' });
    await controller.sync('note-a', { merged: '# Merged secret' });
    expect(remote.write).not.toHaveBeenCalled();
    expect(controller.getSnapshot().collection?.notes[0]).toMatchObject({ localContent: '# Merged secret', conflict: { content: 'Server3' } });
    const recovered = await decryptCollection(required(store.value), cryptoKey);
    expect(recovered.notes[0]?.localContent).toBe('# Merged secret');
});

it('keeps a merge after a conditional write conflict and never retries a force write', async () => {
    const { controller, remote } = setup();
    await editLocally(controller);
    remote.read.mockResolvedValue({ ...remoteNote, content: 'Server2', etag: 'server2' });
    await controller.sync('note-a');
    remote.write.mockRejectedValue(new GnosiApiError(new Response(null, { status: 409 }), { detail: { error: 'etag_mismatch' } }));
    remote.read.mockResolvedValueOnce({ ...remoteNote, content: 'Server2', etag: 'server2' }).mockResolvedValue({ ...remoteNote, content: 'Server3', etag: 'server3' });
    await controller.sync('note-a', { merged: 'Merge' });
    expect(remote.write).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().collection?.notes[0]).toMatchObject({ localContent: 'Merge', conflict: { etag: 'server3' } });
});

it('refuses another account and invalidates pending decrypts and reads when locked', async () => {
    const { controller, remote, switchScope } = setup();
    const unlock = controller.unlock(passphrase);
    controller.lock();
    await unlock;
    expect(controller.getSnapshot().collection).toBeNull();
    await controller.unlock(passphrase);
    const pending = deferred<typeof remoteNote>();
    remote.read.mockReturnValue(pending.promise);
    const sync = controller.sync('note-a');
    await vi.waitFor(() => { expect(remote.read).toHaveBeenCalled(); });
    switchScope();
    controller.checkScope();
    pending.resolve(remoteNote);
    await sync;
    expect(controller.getSnapshot().collection).toBeNull();
    expect(remote.write).not.toHaveBeenCalled();
    await controller.unlock(passphrase);
    expect(controller.getSnapshot().collection).toBeNull();
    expect(controller.getSnapshot().error).toBe('scope');
});

it('detects another tab’s saved revision without overwriting it or sending stale local content', async () => {
    const { controller, remote, store } = setup();
    await editLocally(controller);
    const another = await encryptCollection({ ...collection, notes: [{ ...required(collection.notes[0]), localContent: 'Other tab' }] }, cryptoKey, initial.salt, 3);
    store.value = another;
    await controller.sync('note-a');
    expect(remote.write).not.toHaveBeenCalled();
    expect(store.value).toEqual(another);
    expect(controller.getSnapshot().error).toBe('changed');
    expect(controller.getSnapshot().collection).toBeNull();
});

describe('opt-in storage', () => {
    it('does not download bodies while browsing, and does not replace existing local edits when added twice', async () => {
        const { controller, remote } = setup();
        await editLocally(controller);
        await controller.browse();
        expect(remote.read).not.toHaveBeenCalled();
        await controller.add('note-a');
        expect(remote.read).not.toHaveBeenCalled();
        expect(controller.getSnapshot().collection?.notes[0]?.localContent).toBe('# Local secret');
    });
    it('keeps drafts visible after storage failure', async () => {
        const { controller, store } = setup();
        await controller.unlock(passphrase);
        controller.edit('note-a', 'Unsaved secret');
        store.write.mockRejectedValueOnce(new OfflineError('storage'));
        await controller.saveLocal('note-a');
        expect(controller.getSnapshot()).toMatchObject({ error: 'storage', drafts: { 'note-a': 'Unsaved secret' } });
    });
});
