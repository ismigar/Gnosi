import type { Middleware } from 'openapi-fetch';

import { setActiveVaultCookie } from './vault-context';


const STORAGE_KEYS = {
  userEmail: 'gnosi_user_email',
  userId: 'gnosi_user_id',
  vaultId: 'gnosi_active_vault',
  workspaceId: 'gnosi_workspace_id',
} as const;


function readStorage(key: string): string {
  try {
    return typeof localStorage === 'undefined' ? '' : localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}


export interface RequestContext {
  readonly userEmail: string;
  readonly userId: string;
  readonly vaultId: string;
  readonly workspaceId: string;
}


export function currentRequestContext(): RequestContext {
  return {
    userEmail: readStorage(STORAGE_KEYS.userEmail),
    userId: readStorage(STORAGE_KEYS.userId) || 'ismael-legacy',
    vaultId: readStorage(STORAGE_KEYS.vaultId),
    workspaceId: readStorage(STORAGE_KEYS.workspaceId) || 'personal',
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
