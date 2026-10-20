import type { components } from '../../generated/openapi';
import i18n from '../i18n/i18n';
import { emitAppEvent } from '../platform/app-events';
import { defineStorageKey, jsonStorageCodec, readStorageResult, writeStorage } from '../platform/browser-storage';
import { apiClient } from './client';
import { GnosiApiError, unwrapApiResult } from './errors';
import { currentRequestContext, type RequestContext } from './request-context';

type CreationInput = components['schemas']['PageSaveRequest'];
export type CreationStatus = components['schemas']['PageCreationStatusResponse'];
export interface PendingCreation { readonly key: string; readonly title: string; readonly fingerprint: string }

function isPendingList(value: unknown): value is PendingCreation[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'object' && item !== null
    && 'key' in item && typeof item.key === 'string' && 'title' in item && typeof item.title === 'string'
    && 'fingerprint' in item && typeof item.fingerprint === 'string');
}

function storageKey(context: RequestContext) {
  return defineStorageKey(`gnosi_page_creations:${JSON.stringify([context.userId, context.userEmail, context.workspaceId, context.vaultId])}`,
    jsonStorageCodec(isPendingList));
}

function readPending(context: RequestContext): PendingCreation[] {
  const stored = readStorageResult(storageKey(context));
  if (!stored.ok) throw new Error(i18n.t('creation_recovery.storage_unavailable'));
  return stored.value ?? [];
}

export function pendingPageCreations(): PendingCreation[] { return readPending(currentRequestContext()); }

function updatePending(context: RequestContext, list: PendingCreation[]): void {
  if (!writeStorage(storageKey(context), list)) throw new Error(i18n.t('creation_recovery.storage_unavailable'));
  emitAppEvent('gnosi:page-creations-changed');
}

async function withCreationLock<T>(context: RequestContext, action: () => T): Promise<T> {
  const browser: { readonly locks?: LockManager } | undefined = typeof navigator === 'undefined' ? undefined : navigator;
  if (!browser?.locks) {
    throw new Error(i18n.t('creation_recovery.coordination_unavailable'));
  }
  return browser.locks.request(storageKey(context).name, action);
}

export async function acknowledgePageCreation(key: string, context = currentRequestContext()): Promise<void> {
  await withCreationLock(context, () => {
    updatePending(context, readPending(context).filter(item => item.key !== key));
  });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}

function headers(context: RequestContext): Record<string, string> {
  return { 'X-Vault-ID': context.vaultId, 'X-Workspace-ID': context.workspaceId,
    'X-User-ID': context.userId, 'X-User-Email': context.userEmail };
}

export async function fetchPageCreationStatus(key: string, context = currentRequestContext()): Promise<CreationStatus> {
  return unwrapApiResult(await apiClient.GET('/api/vault/pages/creation-requests/{creation_key}', {
    params: { path: { creation_key: key } }, headers: headers(context),
  }));
}

export async function resumePageCreation(key: string, context = currentRequestContext()): Promise<components['schemas']['PageMutationResponse']> {
  return unwrapApiResult(await apiClient.POST('/api/vault/pages/creation-requests/{creation_key}/resume', {
    params: { path: { creation_key: key } }, headers: headers(context),
  }));
}

const running = new Map<string, Promise<components['schemas']['PageMutationResponse']>>();

export function createRecoverablePage(body: CreationInput): Promise<components['schemas']['PageMutationResponse']> {
  const context = currentRequestContext();
  const fingerprint = canonical(body);
  const operation = `${storageKey(context).name}:${fingerprint}`;
  const active = running.get(operation);
  if (active) return active;
  const run = async () => {
    // Hold the browser-wide lock only for the local read/modify/write. Network
    // waits must not prevent another window from recovering the same identity.
    const { entry, existing } = await withCreationLock(context, () => {
      const list = readPending(context);
      const previous = list.find(item => item.fingerprint === fingerprint);
      const entry = previous ?? { key: crypto.randomUUID(), title: body.title, fingerprint };
      if (!previous) updatePending(context, [...list, entry]);
      return { entry, existing: previous !== undefined };
    });
    if (existing) {
      try {
        const status = await fetchPageCreationStatus(entry.key, context);
        if (status.status === 'completed' && status.result) {
          await acknowledgePageCreation(entry.key, context);
          return status.result;
        }
        throw new Error(i18n.t(`creation_recovery.${status.status}`));
      } catch (error) {
        // A missing reservation can be submitted with the SAME key safely.
        if (!(error instanceof GnosiApiError && error.status === 404)) throw error;
      }
    }
    const result = unwrapApiResult(await apiClient.POST('/api/vault/pages', {
      body, headers: { ...headers(context), 'Idempotency-Key': entry.key },
    }));
    await acknowledgePageCreation(entry.key, context);
    return result;
  };
  const promise = run().finally(() => { running.delete(operation); });
  running.set(operation, promise);
  return promise;
}
