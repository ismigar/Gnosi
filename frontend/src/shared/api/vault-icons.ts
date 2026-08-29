import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { GnosiApiError, unwrapApiResult } from './errors';
import { transportFetch } from './transports';


export type CustomIconLibrary = components['schemas']['CustomIconsResponse'];
export type UnsplashCoverSearch = components['schemas']['UnsplashSearchResponse'];
export type VaultCoverAsset = components['schemas']['ImageAssetResponse'];
export type VaultIconAsset = components['schemas']['IconAssetResponse'];


export async function fetchCustomIcons(
  signal?: AbortSignal,
): Promise<CustomIconLibrary> {
  return unwrapApiResult<CustomIconLibrary, unknown>(
    await apiClient.GET('/api/vault/custom-icons', { signal }),
  );
}


export async function saveCustomIcons(
  icons: string[],
  signal?: AbortSignal,
): Promise<CustomIconLibrary> {
  return unwrapApiResult<CustomIconLibrary, unknown>(
    await apiClient.PUT('/api/vault/custom-icons', {
      body: { icons },
      signal,
    }),
  );
}


export async function importVaultIconUrl(
  url: string,
  signal?: AbortSignal,
): Promise<VaultIconAsset> {
  return unwrapApiResult<VaultIconAsset, unknown>(
    await apiClient.POST('/api/vault/import-icon-url', {
      body: { url },
      signal,
    }),
  );
}


export async function searchUnsplashCovers(
  query: string,
  page = 1,
  signal?: AbortSignal,
): Promise<UnsplashCoverSearch> {
  return unwrapApiResult<UnsplashCoverSearch, unknown>(
    await apiClient.GET('/api/vault/unsplash/search', {
      params: { query: { page, query } },
      signal,
    }),
  );
}


function isVaultCoverAsset(payload: unknown): payload is VaultCoverAsset {
  return Boolean(
    payload
    && typeof payload === 'object'
    && 'url' in payload
    && typeof payload.url === 'string'
    && 'path' in payload
    && typeof payload.path === 'string',
  );
}


function isVaultIconAsset(payload: unknown): payload is VaultIconAsset {
  return Boolean(
    payload
    && typeof payload === 'object'
    && 'url' in payload
    && typeof payload.url === 'string'
    && 'path' in payload
    && typeof payload.path === 'string',
  );
}


export async function uploadVaultCover(file: File): Promise<VaultCoverAsset> {
  const body = new FormData();
  body.set('file', file);
  const response = await transportFetch('/api/vault/upload-cover', {
    body,
    method: 'POST',
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new GnosiApiError(response, payload);
  if (!isVaultCoverAsset(payload)) {
    throw new GnosiApiError(response, 'Upload did not return a valid cover');
  }
  return payload;
}


export async function uploadVaultIcon(
  file: File,
  timeoutMs = 30_000,
): Promise<VaultIconAsset> {
  const body = new FormData();
  body.set('file', file);
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await transportFetch('/api/vault/upload-icon', {
      body,
      method: 'POST',
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw new GnosiApiError(response, payload);
    if (!isVaultIconAsset(payload)) {
      throw new GnosiApiError(response, 'Upload did not return a valid icon');
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error('Icon upload timed out');
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
