import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { GnosiApiError, unwrapApiResult, type ApiResult } from './errors';
import { applyRequestContext } from './request-context';
import { canonicalizeVaultApiUrl } from './vault-context';


export type JsonRecord = components['schemas']['RegistryRecord'];
export type VaultAssetUpload = components['schemas']['AssetUploadResponse'];

export interface VaultFileLocation extends JsonRecord {
  path: string;
  url: string | null;
}

export interface VaultLocalFileRegistration extends VaultFileLocation {
  extension: string;
  kind: string;
  name: string;
  size: number;
  token: string;
  url: string;
}

export interface VaultUploadProgress {
  loaded: number;
  total?: number;
}

export interface VaultInsertUploadOptions {
  destFolder?: string;
  onProgress?: (progress: VaultUploadProgress) => void;
  propertyName?: string;
  signal?: AbortSignal;
  storageFolder?: string;
  tableId?: string;
  targetName?: string;
}


function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function requireJsonRecord(value: unknown, label: string): JsonRecord {
  if (!isJsonRecord(value)) {
    throw new TypeError(`The ${label} API returned an invalid JSON object`);
  }
  return value;
}


function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`The ${label} API returned an invalid string`);
  }
  return value;
}


function unwrapJsonRecord(
  result: ApiResult<unknown>,
  label: string,
): JsonRecord {
  return requireJsonRecord(unwrapApiResult<unknown, unknown>(result), label);
}


function responseHeaders(xhr: XMLHttpRequest): Headers {
  const headers = new Headers();
  for (const line of xhr.getAllResponseHeaders().split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return headers;
}


function parseJsonResponse(xhr: XMLHttpRequest): unknown {
  if (!xhr.responseText) return undefined;
  try {
    return JSON.parse(xhr.responseText) as unknown;
  } catch {
    return xhr.responseText;
  }
}


function xhrResponse(xhr: XMLHttpRequest): Response {
  return new Response(null, {
    headers: responseHeaders(xhr),
    status: xhr.status,
    statusText: xhr.statusText,
  });
}


function abortReason(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  if (typeof signal?.reason === 'string') {
    return new DOMException(signal.reason, 'AbortError');
  }
  return new DOMException('The operation was aborted.', 'AbortError');
}


function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error('Vault upload failed', { cause: error });
}


async function uploadMultipartJson(
  path: string,
  body: FormData,
  options: Pick<VaultInsertUploadOptions, 'onProgress' | 'signal'>,
): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const headers = new Headers();
    applyRequestContext(headers);
    let settled = false;

    const cleanup = () => {
      options.signal?.removeEventListener('abort', abortUpload);
    };
    const resolveOnce = (value: JsonRecord) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abortUpload = () => {
      xhr.abort();
    };

    xhr.open('POST', canonicalizeVaultApiUrl(path), true);
    xhr.withCredentials = true;
    // The legacy callers explicitly used timeout: 0 because cloud-backed files
    // may take tens of seconds to materialize. Keep the upload unbounded.
    xhr.timeout = 0;
    headers.forEach((value, name) => {
      xhr.setRequestHeader(name, value);
    });
    xhr.upload.addEventListener('progress', (event) => {
      options.onProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : undefined,
      });
    });
    xhr.addEventListener('load', () => {
      const payload = parseJsonResponse(xhr);
      const response = xhrResponse(xhr);
      if (xhr.status < 200 || xhr.status >= 300) {
        rejectOnce(new GnosiApiError(response, payload));
        return;
      }
      try {
        resolveOnce(requireJsonRecord(payload, 'Vault upload'));
      } catch (error) {
        rejectOnce(normalizeError(error));
      }
    });
    xhr.addEventListener('error', () => {
      rejectOnce(new Error('Network Error'));
    });
    xhr.addEventListener('timeout', () => {
      rejectOnce(new Error('timeout of 0ms exceeded'));
    });
    xhr.addEventListener('abort', () => {
      rejectOnce(abortReason(options.signal));
    });

    if (options.signal?.aborted) {
      rejectOnce(abortReason(options.signal));
      return;
    }
    options.signal?.addEventListener('abort', abortUpload, { once: true });
    xhr.send(body);
  });
}


function uploadPath(options: VaultInsertUploadOptions): string {
  if (options.propertyName) {
    if (!options.tableId) {
      throw new TypeError('tableId is required for a property file upload');
    }
    const params = new URLSearchParams({
      table_id: options.tableId,
      property_name: options.propertyName,
      storage_folder: options.storageFolder || 'assets',
    });
    if (options.targetName) params.set('target_name', options.targetName);
    return `/api/vault/upload-property-file?${params.toString()}`;
  }
  return options.tableId
    ? `/api/vault/assets/upload?table_id=${encodeURIComponent(options.tableId)}`
    : '/api/vault/assets/upload';
}


export async function uploadVaultInsertFile(
  file: File,
  options: VaultInsertUploadOptions = {},
): Promise<VaultFileLocation> {
  const body = new FormData();
  body.append('file', file);
  if (options.propertyName && options.destFolder) {
    body.append('dest_folder', options.destFolder);
  }
  const payload = await uploadMultipartJson(uploadPath(options), body, options);
  const url = payload.url;
  if (url !== null && typeof url !== 'string') {
    throw new TypeError('The Vault upload API returned an invalid URL');
  }
  return {
    ...payload,
    path: requireString(payload.path, 'Vault upload path'),
    url,
  };
}


export async function linkExistingVaultFile(
  filePath: string,
  targetName: string,
): Promise<VaultFileLocation> {
  const payload = unwrapJsonRecord(
    await apiClient.POST('/api/vault/link-existing-file', {
      body: { file_path: filePath, target_name: targetName },
    }),
    'existing file link',
  );
  const url = payload.url;
  if (url !== null && typeof url !== 'string') {
    throw new TypeError('The existing file link API returned an invalid URL');
  }
  return {
    ...payload,
    path: requireString(payload.path, 'linked file path'),
    url,
  };
}


export async function registerLocalVaultFile(
  filePath: string,
): Promise<VaultLocalFileRegistration> {
  const payload = unwrapJsonRecord(
    await apiClient.POST('/api/vault/local-file/register', {
      body: { file_path: filePath },
    }),
    'local file registration',
  );
  const size = payload.size;
  if (typeof size !== 'number') {
    throw new TypeError('The local file registration API returned an invalid size');
  }
  return {
    ...payload,
    extension: requireString(payload.extension, 'local file extension'),
    kind: requireString(payload.kind, 'local file kind'),
    name: requireString(payload.name, 'local file name'),
    path: requireString(payload.path, 'local file path'),
    size,
    token: requireString(payload.token, 'local file token'),
    url: requireString(payload.url, 'local file URL'),
  };
}
