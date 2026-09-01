// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordChatFeedback, requestChatMessageJob, rewindChatSession } from '../../../shared/api/chat-message-actions';
import { messageFeedback } from './messageActionModel';

afterEach(() => { vi.unstubAllGlobals(); });
function requestAt(mock: ReturnType<typeof vi.fn<typeof fetch>>, index = 0): Request {
  const request = mock.mock.calls[index]?.[0]; if (!(request instanceof Request)) throw new Error('Missing Request'); return request;
}
describe('message action HTTP contracts', () => {
  it('sends only feedback metadata and accepts an empty successful response', async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal('fetch', mock);
    const body = messageFeedback({ content: 'PRIVATE RESPONSE', role: 'assistant', turnId: 'turn', timings: { total_ms: 120 } }, 'agent', 'session', 'ca', 'up');
    if (!body) throw new Error('Missing feedback'); await recordChatFeedback(body);
    const request = requestAt(mock); expect(request.method).toBe('POST'); expect(new URL(request.url).pathname).toBe('/api/chat/feedback');
    const payload: unknown = await request.json(); expect(payload).toMatchObject({ agent_id: 'agent', session_id: 'session', turn_id: 'turn', rating: 'up', duration_ms: 120 });
    expect(JSON.stringify(payload)).not.toContain('PRIVATE RESPONSE');
  });
  it('keeps status read-only and uses distinct resume/cancel POST paths', async () => {
    const mock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(Response.json({ job_id: 'job/one', status: 'running' }))); vi.stubGlobal('fetch', mock);
    for (const action of ['status', 'resume', 'cancel'] as const) await expect(requestChatMessageJob('job/one', action)).resolves.toMatchObject({ job_id: 'job/one' });
    expect([0, 1, 2].map((index) => [requestAt(mock, index).method, new URL(requestAt(mock, index).url).pathname])).toEqual([
      ['GET', '/api/ai/jobs/job%2Fone'], ['POST', '/api/ai/jobs/job%2Fone/resume'], ['POST', '/api/ai/jobs/job%2Fone/cancel'],
    ]);
  });
  it('rewinds the exact encoded session and optional notebook with the original turn boundary', async () => {
    const messages = [{ role: 'user', content: 'retained' }];
    const mock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ messages })); vi.stubGlobal('fetch', mock);
    await expect(rewindChatSession({ agentId: 'agent/a', id: 'session b' }, { before_turn_id: 'turn', keep_messages: 2 }, 'notebook/b')).resolves.toEqual(messages);
    const request = requestAt(mock); const url = new URL(request.url);
    expect(url.pathname).toBe('/api/chat/sessions/agent%2Fa/session%20b/rewind'); expect(url.searchParams.get('notebook_id')).toBe('notebook/b'); expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({ before_turn_id: 'turn', keep_messages: 2 });
  });
  it('rejects HTTP errors without retrying or treating a null rewind as a conversation', async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({}, { status: 503 })).mockResolvedValueOnce(Response.json(null)); vi.stubGlobal('fetch', mock);
    await expect(requestChatMessageJob('job', 'resume')).rejects.toThrow('503');
    await expect(rewindChatSession({ agentId: 'agent', id: 'session' }, { keep_messages: 0 })).rejects.toThrow('invalid response');
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
