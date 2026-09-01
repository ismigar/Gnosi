import type { Middleware } from 'openapi-fetch';

import {
  defineStorageKey,
  readStorage,
  stringStorageCodec,
  type BrowserStorageKey,
} from '../platform/browser-storage';
import { setActiveVaultCookie } from './vault-context';


export const USER_EMAIL_STORAGE_KEY = defineStorageKey(
  'gnosi_user_email',
  stringStorageCodec,
);
export const USER_ID_STORAGE_KEY = defineStorageKey(
  'gnosi_user_id',
  stringStorageCodec,
);
export const USER_ROLE_STORAGE_KEY = defineStorageKey(
  'gnosi_role',
  stringStorageCodec,
);
export const VAULT_ID_STORAGE_KEY = defineStorageKey(
  'gnosi_active_vault',
  stringStorageCodec,
);
export const WORKSPACE_ID_STORAGE_KEY = defineStorageKey(
  'gnosi_workspace_id',
  stringStorageCodec,
);


function readContextStorage(
  key: BrowserStorageKey<string>,
): string {
  return readStorage(key) ?? '';
}


export interface RequestContext {
  readonly userEmail: string;
  readonly userId: string;
  readonly vaultId: string;
  readonly workspaceId: string;
}


export function currentRequestContext(): RequestContext {
  return {
    userEmail: readContextStorage(USER_EMAIL_STORAGE_KEY),
    userId: readContextStorage(USER_ID_STORAGE_KEY) || 'ismael-legacy',
    vaultId: readContextStorage(VAULT_ID_STORAGE_KEY),
    workspaceId: readContextStorage(WORKSPACE_ID_STORAGE_KEY) || 'personal',
  };
}


function setHeaderWhenAbsent(headers: Headers, name: string, value: string): void {
  if (value && !headers.has(name)) headers.set(name, value);
}


export function applyRequestContext(headers: Headers): RequestContext {
  const context = currentRequestContext();
  setHeaderWhenAbsent(headers, 'X-Workspace-ID', context.workspaceId);
  setHeaderWhenAbsent(headers, 'X-User-ID', context.userId);
  setHeaderWhenAbsent(headers, 'X-User-Email', context.userEmail);
  setHeaderWhenAbsent(headers, 'X-Vault-ID', context.vaultId);
  setActiveVaultCookie(context.vaultId || null);
  return context;
}


export const requestContextMiddleware: Middleware = {
  onRequest({ request }) {
    applyRequestContext(request.headers);
    return request;
  },
};
