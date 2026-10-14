import type { EncryptedCollection } from './crypto';
import { OfflineError } from './model';

export interface OfflineStore {
    read(): Promise<EncryptedCollection | null>;
    write(value: EncryptedCollection, expectedRevision: number): Promise<void>;
    remove(expectedRevision: number): Promise<void>;
}

const DATABASE = 'gnosi-offline-v1';
const STORE = 'encrypted';
const KEY = 'collection';

async function open(): Promise<IDBDatabase> {
    if (!('indexedDB' in globalThis)) throw new OfflineError('unsupported');
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
        request.onsuccess = () => { resolve(request.result); };
        request.onerror = () => { reject(new OfflineError('storage')); };
        request.onblocked = () => { reject(new OfflineError('storage')); };
    });
}

/** The database contains only salt, IV, revision and authenticated ciphertext. */
export const indexedDbOfflineStore: OfflineStore = {
    async read() {
        const db = await open();
        try {
            return await new Promise<EncryptedCollection | null>((resolve, reject) => {
                const transaction = db.transaction(STORE, 'readonly');
                const request = transaction.objectStore(STORE).get(KEY);
                transaction.oncomplete = () => { resolve((request.result as EncryptedCollection | undefined) ?? null); };
                transaction.onabort = transaction.onerror = () => { reject(new OfflineError('storage')); };
            });
        } finally { db.close(); }
    },
    write(value, expectedRevision) { return mutate(expectedRevision, value); },
    remove(expectedRevision) { return mutate(expectedRevision, null); },
};

async function mutate(expectedRevision: number, value: EncryptedCollection | null): Promise<void> {
    const db = await open();
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(STORE, 'readwrite');
            const store = transaction.objectStore(STORE);
            const request = store.get(KEY);
            let conflict = false;
            request.onsuccess = () => {
                const current = request.result as EncryptedCollection | undefined;
                if ((current?.revision ?? 0) !== expectedRevision) {
                    conflict = true;
                    transaction.abort();
                    return;
                }
                if (value) store.put(value, KEY);
                else store.delete(KEY);
            };
            transaction.oncomplete = () => { resolve(); };
            transaction.onabort = transaction.onerror = () => { reject(new OfflineError(conflict ? 'changed' : 'storage')); };
        });
    } finally { db.close(); }
}
