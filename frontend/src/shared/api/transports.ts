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


function waitForDownload(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    function abort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function readResponse(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : undefined;
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  const signal = init?.signal ?? request?.signal;
  let response = await globalThis.fetch(input, init);
  if (method !== 'GET' && method !== 'HEAD') return response;

  // A synchronous reader on the server can hand a coordinated download to
  // its next read. Keep the original vault headers and cancellation signal.
  const deadline = Date.now() + 45_000;
  for (const minimum of [1000, 2000, 4000, 8000, 16000]) {
    if (response.status !== 503 || response.headers.get('X-Gnosi-File-Availability') !== 'pending') break;
    const retry = Number(response.headers.get('Retry-After'));
    const delay = Math.max(minimum, Number.isFinite(retry) ? retry * 1000 : 0);
    if (Date.now() + delay > deadline) break;
    await response.body?.cancel();
    await waitForDownload(delay, signal);
    response = await globalThis.fetch(input, init);
  }
  return response;
}

export const transportFetch: typeof globalThis.fetch = (input, init) => {
  const parsed = requestUrl(input);
  if (!isSameOriginApi(parsed)) return globalThis.fetch(input, init);
  if (input instanceof Request) return readResponse(input, init);
  const headers = new Headers(init?.headers);
  applyRequestContext(headers);
  return readResponse(canonicalInput(input, headers), {
    ...init,
    credentials: init?.credentials ?? 'include',
    headers,
  });
};
