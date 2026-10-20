import type { FormValue } from '../../shared/api/forms';
import { defineStorageKey, jsonStorageCodec, readStorage, removeStorage, writeStorage } from '../../shared/platform/browser-storage';

export interface PendingSubmission { requestId: string; values: Record<string, FormValue> }

export function createSubmissionIdentity(): string {
  // getRandomValues is available on HTTP self-hosted origins too.
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function isEmptyAnswer(value: FormValue | undefined): boolean {
  return value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0);
}

function isValue(value: unknown): value is FormValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    || (Array.isArray(value) && value.every(item => typeof item === 'string'));
}

function isPending(raw: unknown): raw is PendingSubmission {
  if (!raw || typeof raw !== 'object' || !('requestId' in raw) || !('values' in raw)) return false;
  if (typeof raw.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(raw.requestId)) return false;
  return Boolean(raw.values && typeof raw.values === 'object' && !Array.isArray(raw.values)
    && Object.values(raw.values).every(isValue));
}

function storageKey(token: string) {
  return defineStorageKey(`gnosi:public-form:${token}`, jsonStorageCodec(isPending), 'session');
}

export function readPendingSubmission(token: string): PendingSubmission | null {
  return readStorage(storageKey(token)) ?? null;
}

export function savePendingSubmission(token: string, pending: PendingSubmission): void {
  writeStorage(storageKey(token), pending);
}

export function clearPendingSubmission(token: string): void {
  removeStorage(storageKey(token));
}
