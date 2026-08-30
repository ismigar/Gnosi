import { vi, type Mock } from 'vitest';

export type FetchMock = Mock<typeof fetch>;

export function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

export function jsonResponse(value: unknown = {}, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function installFetch(implementation: typeof fetch = () => Promise.reject(new Error('Unexpected fixture request'))): FetchMock {
  const mock = vi.fn(implementation);
  vi.stubGlobal('fetch', mock);
  return mock;
}

export function request(mock: FetchMock, match: number | string = 0) {
  const found = typeof match === 'number' ? mock.mock.calls[match]
    : mock.mock.calls.find(([url]) => requestUrl(url).includes(match));
  if (!found) throw new Error(`Missing fixture request: ${String(match)}`);
  const [url, init] = found;
  return { url: requestUrl(url), init, headers: new Headers(init?.headers) };
}

export function requestBody(mock: FetchMock, match: number | string = 0): Record<string, unknown> {
  const { init } = request(mock, match);
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON string request body');
  const value: unknown = JSON.parse(init.body);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object request body');
  return value as Record<string, unknown>;
}
