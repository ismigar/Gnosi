import { MAX_COLLECTION_LENGTH, OfflineError, parseCollection, type OfflineCollection } from './model';

export interface EncryptedCollection {
    readonly version: 1;
    readonly revision: number;
    readonly salt: string;
    readonly iv: string;
    readonly data: string;
}

const ITERATIONS = 600_000;
const encoder = new TextEncoder();
const aad = (revision: number, salt: string) => encoder.encode(`gnosi-offline:1:${String(revision)}:${salt}`);

function encode(bytes: Uint8Array): string {
    let text = '';
    for (let index = 0; index < bytes.length; index += 8192) {
        text += String.fromCharCode(...bytes.subarray(index, index + 8192));
    }
    return btoa(text);
}
function decode(text: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(atob(text), character => character.charCodeAt(0));
}
function webCrypto(): Crypto {
    const crypto = (globalThis as { crypto?: Crypto }).crypto;
    if (!crypto?.subtle) throw new OfflineError('unsupported');
    return crypto;
}

export function newSalt(): string {
    return encode(webCrypto().getRandomValues(new Uint8Array(16)));
}

export async function deriveKey(passphrase: string, salt: string): Promise<CryptoKey> {
    if (passphrase.length < 12 || passphrase.length > 1024) throw new OfflineError('passphrase');
    const material = await webCrypto().subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const bytes = decode(salt);
    if (bytes.length !== 16) throw new OfflineError('unlock');
    return webCrypto().subtle.deriveKey({ name: 'PBKDF2', salt: bytes, iterations: ITERATIONS, hash: 'SHA-256' },
        material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptCollection(collection: OfflineCollection, key: CryptoKey,
    salt: string, revision: number): Promise<EncryptedCollection> {
    const serialized = JSON.stringify(collection);
    if (serialized.length > MAX_COLLECTION_LENGTH) throw new OfflineError('limit');
    parseCollection(serialized);
    const iv = webCrypto().getRandomValues(new Uint8Array(12));
    const data = await webCrypto().subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(revision, salt) },
        key, encoder.encode(serialized));
    return { version: 1, revision, salt, iv: encode(iv), data: encode(new Uint8Array(data)) };
}

export async function decryptCollection(envelope: EncryptedCollection, key: CryptoKey): Promise<OfflineCollection> {
    try {
        if ((envelope as { version: number }).version !== 1 || !Number.isSafeInteger(envelope.revision) || envelope.revision < 1
            || envelope.data.length > MAX_COLLECTION_LENGTH * 6 || decode(envelope.iv).length !== 12) {
            throw new OfflineError('unlock');
        }
        const data = await webCrypto().subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv),
            additionalData: aad(envelope.revision, envelope.salt) }, key, decode(envelope.data));
        return parseCollection(new TextDecoder('utf-8', { fatal: true }).decode(data));
    } catch {
        throw new OfflineError('unlock');
    }
}
