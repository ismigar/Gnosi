import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteChatSessionCheckpoint, fetchChatSessionHistory } from './chat-sessions';

const session = { agentId: 'agent/a', id: 'session b' };
afterEach(() => { vi.unstubAllGlobals(); });

describe('chat session HTTP boundary', () => {
  it('encodes both identity segments and forwards notebook scope', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ messages: [{ role: 'user', content: 'canonical' }] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchChatSessionHistory(session, 'notebook/id')).resolves.toEqual([{ role: 'user', content: 'canonical' }]);
    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected generated Request');
    const url = new URL(request.url);
    expect(url.pathname).toBe('/api/chat/sessions/agent%2Fa/session%20b');
    expect(url.searchParams.get('notebook_id')).toBe('notebook/id');
  });
  it('does not treat a failed checkpoint deletion as success or delete an unidentified session', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ detail: 'offline' }, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteChatSessionCheckpoint(null)).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(deleteChatSessionCheckpoint(session)).rejects.toThrow('offline');
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request instanceof Request && request.method).toBe('DELETE');
  });
});
