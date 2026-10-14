import { dispatchWindowEvent } from '../platform/browser-events';
import { afterEach, expect, it, vi } from 'vitest';
import { emitAppEvent } from '../platform/app-events';
import { getPluginEditorSelection, registerPluginSourceEditor, replacePluginEditorSelection, type PluginEditorSelection } from './editor-bridge';
import { VAULT_ID_STORAGE_KEY } from '../api/request-context';
import { writeStorage } from '../platform/browser-storage';
import { resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';

afterEach(() => { resetApiTestStorage(); });
it('invalidates a capability on vault switches even when switching back to the same vault', () => {
    const snapshot: PluginEditorSelection = { vaultId: 'a', documentId: 'page', sessionId: 'session', documentVersion: 0, selectionVersion: 0,
        readOnly: false, mainIndex: 0, ranges: [{ from: 0, to: 4, text: 'Text' }] };
    writeStorage(VAULT_ID_STORAGE_KEY, 'a');
    const registration = registerPluginSourceEditor({ getSelection: () => snapshot, replaceSelection: () => snapshot });
    try {
        expect(getPluginEditorSelection()).toBe(snapshot);
        writeStorage(VAULT_ID_STORAGE_KEY, 'b');
        expect(() => replacePluginEditorSelection('wrong vault', snapshot)).toThrow('No active');
        emitAppEvent('gnosi:vault-changed', { id: 'b', name: 'B', slug: 'b' });
        writeStorage(VAULT_ID_STORAGE_KEY, 'a');
        registration.activate();
        expect(() => replacePluginEditorSelection('replay', snapshot)).toThrow('No active');
    } finally { registration.dispose(); }
});

it.each(['gnosi_workspace_id', 'gnosi_user_id', 'gnosi_user_email'])(
    'invalidates old editor reads and replacements on a same-Vault %s change', key => {
        writeApiTestStorage(key, 'original');
        writeStorage(VAULT_ID_STORAGE_KEY, 'same-vault');
        const snapshot: PluginEditorSelection = { vaultId: 'same-vault', documentId: 'page', sessionId: 'session', documentVersion: 0, selectionVersion: 0,
            readOnly: false, mainIndex: 0, ranges: [{ from: 0, to: 4, text: 'Text' }] };
        const replace = vi.fn(() => snapshot);
        const registration = registerPluginSourceEditor({ getSelection: () => snapshot, replaceSelection: replace });
        try {
            const expected = getPluginEditorSelection();
            writeApiTestStorage(key, 'different');
            dispatchWindowEvent(new StorageEvent('storage', { key }));
            expect(() => getPluginEditorSelection()).toThrow('No active');
            expect(() => replacePluginEditorSelection('wrong scope', expected)).toThrow('No active');
            writeApiTestStorage(key, 'original');
            dispatchWindowEvent(new Event('focus'));
            registration.activate();
            expect(() => replacePluginEditorSelection('replayed capability', expected)).toThrow('No active');
            expect(replace).not.toHaveBeenCalled();
        } finally { registration.dispose(); }
    },
);

it('checks context synchronously even without a storage or focus event', () => {
    const snapshot: PluginEditorSelection = { vaultId: '', documentId: 'page', sessionId: 'session', documentVersion: 0, selectionVersion: 0,
        readOnly: false, mainIndex: 0, ranges: [] };
    const replace = vi.fn(() => snapshot);
    const registration = registerPluginSourceEditor({ getSelection: () => snapshot, replaceSelection: replace });
    try {
        writeApiTestStorage('gnosi_user_id', 'different');
        expect(() => replacePluginEditorSelection('wrong account', snapshot)).toThrow('No active');
        expect(replace).not.toHaveBeenCalled();
    } finally { registration.dispose(); }
});
