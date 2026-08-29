import { GnosiApiError } from './errors';
import { transportFetch } from './transports';


export interface VaultAssetUpload {
  readonly is_image: boolean;
  readonly path: string;
  readonly url: string;
}


export interface VaultAssetUploadOptions {
  readonly signal?: AbortSignal;
  readonly tableId?: string;
  readonly targetName?: string;
}


function assetUploadPath(options: VaultAssetUploadOptions): string {
  const params = new URLSearchParams();
  if (options.tableId) params.set('table_id', options.tableId);
  if (options.targetName) params.set('target_name', options.targetName);
  const query = params.toString();
  return query ? `/api/vault/assets/upload?${query}` : '/api/vault/assets/upload';
}


export async function uploadVaultAsset(
  file: File,
  options: VaultAssetUploadOptions = {},
): Promise<VaultAssetUpload> {
  const body = new FormData();
  body.set('file', file);
  const response = await transportFetch(assetUploadPath(options), {
    body,
    method: 'POST',
    signal: options.signal,
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new GnosiApiError(response, payload);
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('url' in payload) ||
    !('path' in payload) ||
    !('is_image' in payload)
  ) {
    throw new GnosiApiError(response, 'The API returned an invalid asset upload');
  }
  return {
    is_image: Boolean(payload.is_image),
    path: String(payload.path),
    url: String(payload.url),
  };
}
