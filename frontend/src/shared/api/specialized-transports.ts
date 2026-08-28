import { transportFetch } from './transports';
import { canonicalizeVaultApiUrl } from './vault-context';


export const WEB_SOCKET_OPEN_STATE = 1;


export function supportsEventStreams(): boolean {
  return typeof globalThis.EventSource === 'function';
}


export function openEventStream(url: string, options?: EventSourceInit): EventSource {
  return new globalThis.EventSource(canonicalizeVaultApiUrl(url), options);
}


export function openWebSocket(
  url: string | URL,
  protocols?: string | string[],
): WebSocket {
  return protocols === undefined
    ? new globalThis.WebSocket(url)
    : new globalThis.WebSocket(url, protocols);
}


export const streamFetch: typeof globalThis.fetch = (input, init) =>
  transportFetch(input, init);


export const downloadFetch: typeof globalThis.fetch = (input, init) =>
  transportFetch(input, init);
