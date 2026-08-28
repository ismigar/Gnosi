import { applyRequestContext } from './request-context';
import { canonicalizeVaultApiUrl, getVaultSlugById } from './vault-context';


function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (input instanceof Request) return new URL(input.url);
    const base = typeof location === 'undefined' ? 'http://localhost' : location.origin;
    return new URL(String(input), base);
  } catch {
    return null;
  }
}


function isSameOriginApi(url: URL | null): boolean {
  if (!url || !url.pathname.startsWith('/api/')) return false;
  if (typeof location === 'undefined') return url.origin === 'http://localhost';
  return url.origin === location.origin;
}


function canonicalInput(
  input: RequestInfo | URL,
  headers: Headers,
): RequestInfo | URL {
  // A Request body can be a one-shot stream. The generated client already
  // adds context through middleware, so preserve Request instances verbatim.
  if (input instanceof Request) return input;
  const parsed = requestUrl(input);
  if (!isSameOriginApi(parsed) || !parsed) return input;
  const explicitVaultId = headers.get('X-Vault-ID') ?? '';
  const explicitSlug = explicitVaultId ? getVaultSlugById(explicitVaultId) : '';
  if (explicitVaultId && !explicitSlug) return input;
  const relative = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  const rewritten = canonicalizeVaultApiUrl(relative, explicitSlug);
  if (typeof input === 'string' && !/^[a-z][a-z\d+.-]*:\/\//i.test(input)) {
    return rewritten;
  }
  return new URL(rewritten, parsed.origin);
}


export const transportFetch: typeof globalThis.fetch = (input, init) => {
  const parsed = requestUrl(input);
  if (!isSameOriginApi(parsed) || input instanceof Request) {
    return globalThis.fetch(input, init);
  }
  const headers = new Headers(init?.headers);
  applyRequestContext(headers);
  return globalThis.fetch(canonicalInput(input, headers), {
    ...init,
    credentials: init?.credentials ?? 'include',
    headers,
  });
};
