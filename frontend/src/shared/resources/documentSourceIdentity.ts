import { getActiveVaultId, getActiveVaultSlug } from '../api/vault-context';

function localDocumentPath(source: string): string | null {
  const match = source.match(/^\/api\/(?:vault|v1\/vaults\/([^/]+)\/knowledge)\/(library|raw|assets)\/([^?#]+)(?:\?([^#]*))?(?:#.*)?$/);
  if (!match) return null;
  const [, encodedSlug, folder, encodedPath, query] = match;
  try {
    if (encodedSlug && decodeURIComponent(encodedSlug) !== getActiveVaultSlug()) return null;
    const params = new URLSearchParams(query);
    if ([...params.keys()].some((key) => key !== 'vault')) return null;
    const vaultId = params.get('vault');
    if (vaultId && vaultId !== getActiveVaultId()) return null;
    return `${folder ?? ''}/${decodeURIComponent(encodedPath ?? '')}`;
  } catch {
    return null;
  }
}

/** Keep the persisted identity independent of the active-vault HTTP route. */
export function canonicalDocumentSource(source: string): string {
  const relative = localDocumentPath(source);
  return relative ? `/api/vault/${relative}` : source;
}

/** Read older manual annotations too, without rewriting their stored records. */
export function documentAnnotationSources(source: string): readonly string[] {
  const relative = localDocumentPath(source);
  if (!relative) return [source];
  const canonical = `/api/vault/${relative}`;
  const slug = getActiveVaultSlug();
  const vaultId = getActiveVaultId();
  return [...new Set([
    canonical,
    source,
    ...(slug ? [`/api/v1/vaults/${encodeURIComponent(slug)}/knowledge/${relative}`] : []),
    ...(vaultId ? [`${canonical}?vault=${encodeURIComponent(vaultId)}`] : []),
  ])];
}
