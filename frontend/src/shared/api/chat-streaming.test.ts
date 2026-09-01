// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelChatStream, readChatStreamReplay, startChatStream, type ChatStreamRequest } from './chat-streaming';

afterEach(() => { vi.unstubAllGlobals(); });
function requestAt(mock: ReturnType<typeof vi.fn<typeof fetch>>, index = 0): Request {
  const call = mock.mock.calls[index]; if (!call) throw new Error('Missing request');
  const [input, init] = call;
  if (input instanceof Request) return input;
  return new Request(new URL(String(input), 'http://localhost'), init);
}
const identity = { streamId: 'stream/id', agentId: 'agent', sessionId: 'session' };
describe('chat stream transport', () => {
  it('preserves the outgoing request, attachment extension and cancellation signal', async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response('')); vi.stubGlobal('fetch', mock);
    const controller = new AbortController();
    const body: ChatStreamRequest = { message: 'request', agent_id: 'agent', session_id: 'session', llm_mode: 'agent_default', turn_id: 'turn', mentions: [{ id: 'note', label: 'Note', type: 'page' }], attachments: [{ name: 'file.txt', size: 2, type: 'text/plain', path: null, url: null }], context_refs: [] };
    await startChatStream(body, controller.signal);
    const request = requestAt(mock); expect(request.method).toBe('POST'); expect(new URL(request.url).pathname).toBe('/api/chat'); expect(await request.json()).toEqual(body);
    expect(mock.mock.calls[0]?.[1]?.signal).toBe(controller.signal); expect(request.headers.get('content-type')).toBe('application/json');
  });
  it('reads numbered NDJSON using the existing stream identity and sequence', async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"type":"message","sequence":3,"content":"🧠"}\n\n{"type":"done","sequence":4}\n')); vi.stubGlobal('fetch', mock);
    await expect(readChatStreamReplay(identity, 2)).resolves.toEqual([{ type: 'message', sequence: 3, content: '🧠' }, { type: 'done', sequence: 4 }]);
    const request = requestAt(mock); const url = new URL(request.url);
    expect(request.method).toBe('GET'); expect(url.pathname).toBe('/api/chat/streams/stream%2Fid'); expect(Object.fromEntries(url.searchParams)).toEqual({ agent_id: 'agent', session_id: 'session', after_sequence: '2' });
  });
  it('returns null for an unavailable stream and rejects malformed replay records', async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(new Response('not json')).mockResolvedValueOnce(new Response('null')); vi.stubGlobal('fetch', mock);
    await expect(readChatStreamReplay(identity, 0)).resolves.toBeNull();
    await expect(readChatStreamReplay(identity, 0)).rejects.toThrow(); await expect(readChatStreamReplay(identity, 0)).rejects.toThrow('Invalid chat replay record'); expect(mock).toHaveBeenCalledTimes(3);
  });
  it('uses a scoped cancellation POST without requiring a success body', async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal('fetch', mock);
    await cancelChatStream(identity); const request = requestAt(mock); const url = new URL(request.url);
    expect(request.method).toBe('POST'); expect(url.pathname).toBe('/api/chat/streams/stream%2Fid/cancel'); expect(Object.fromEntries(url.searchParams)).toEqual({ agent_id: 'agent', session_id: 'session' });
  });
});
