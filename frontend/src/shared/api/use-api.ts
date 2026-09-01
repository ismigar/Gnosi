import { useCallback } from 'react';

import { transportFetch } from './transports';
import {
  defineStorageKey,
  readStorage,
  stringStorageCodec,
} from '../platform/browser-storage';


const WORKSPACE_ID_KEY = defineStorageKey('gnosi_workspace_id', stringStorageCodec);
const USER_EMAIL_KEY = defineStorageKey('gnosi_user_email', stringStorageCodec);
const USER_ID_KEY = defineStorageKey('gnosi_user_id', stringStorageCodec);
const USER_ROLE_KEY = defineStorageKey('gnosi_role', stringStorageCodec);


function responseErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null) return fallback;
  const detail = (payload as Record<string, unknown>).detail;
  return typeof detail === 'string' && detail ? detail : fallback;
}


export function useApi() {
  const getWorkspaceId = useCallback(
    () => readStorage(WORKSPACE_ID_KEY) || 'personal',
    [],
  );

  const getUserEmail = useCallback(
    () => readStorage(USER_EMAIL_KEY) || '',
    [],
  );

  const apiFetch = useCallback(async <T = unknown>(
    url: string,
    options: RequestInit = {},
  ): Promise<T> => {
    const workspaceId = getWorkspaceId();
    const userId = readStorage(USER_ID_KEY) || 'ismael-legacy';
    const userEmail = getUserEmail();
    const headers = new Headers(options.headers);
    headers.set('X-Workspace-ID', workspaceId);
    headers.set('X-User-ID', userId);
    headers.set('X-User-Email', userEmail);
    if (options.body instanceof FormData) headers.delete('Content-Type');
    else headers.set('Content-Type', 'application/json');

    const response = await transportFetch(url, {
      credentials: 'include',
      ...options,
      headers,
    });

    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      throw new Error(responseErrorMessage(payload, response.statusText));
    }

    return await response.json() as T;
  }, [getWorkspaceId, getUserEmail]);

  const apiGet = useCallback(<T = unknown>(
    url: string,
    options: RequestInit = {},
  ): Promise<T> => apiFetch<T>(url, { ...options, method: 'GET' }), [apiFetch]);

  const apiPost = useCallback(<T = unknown>(
    url: string,
    body: unknown = {},
    method = 'POST',
  ): Promise<T> => apiFetch<T>(url, {
    ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }),
    method,
  }), [apiFetch]);

  const userId = readStorage(USER_ID_KEY);
  return {
    apiFetch,
    apiGet,
    apiPost,
    workspaceId: getWorkspaceId(),
    role: readStorage(USER_ROLE_KEY) || (userId ? 'viewer' : 'admin'),
    userEmail: getUserEmail(),
  };
}
