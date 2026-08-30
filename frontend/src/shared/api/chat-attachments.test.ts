// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeChatAttachment, uploadChatAttachment } from './chat-attachments';

afterEach(() => { vi.unstubAllGlobals(); });
const scope = { agent_id: 'agent', session_id: 'session' };
function requestAt(mock: ReturnType<typeof vi.fn<typeof fetch>>, index = 0): Request {
  const request = mock.mock.calls[index]?.[0];
  if (!(request instanceof Request)) throw new Error('Expected generated Request');
  return request;
}

describe('typed chat attachment HTTP boundary', () => {
  it('uploads the original file as multipart in the exact chat scope', async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ path: 'attachments/file.txt' }));
    vi.stubGlobal('fetch', mock);
    const file = new File(['test'], 'file.txt', { type: 'text/plain' });
    await expect(uploadChatAttachment(file, scope, 'failed')).resolves.toBe('attachments/file.txt');
    const request = requestAt(mock);
    expect(new URL(request.url).pathname).toBe('/api/chat/attachments');
    expect(request.method).toBe('POST');
    expect(request.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
    const body = await request.text();
    expect(body).toContain('filename="file.txt"');
    expect(body).toContain('name="agent_id"');
    expect(body).toContain('agent');
    expect(body).toContain('name="session_id"');
  });
  it('reports upload errors and does not invent a path for an empty response', async () => {
    const mock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ detail: 'too large' }, { status: 413 }))
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal('fetch', mock);
    const file = new File([], 'file.txt');
    await expect(uploadChatAttachment(file, scope, 'failed')).rejects.toThrow('too large');
    await expect(uploadChatAttachment(file, scope, 'failed')).resolves.toBeNull();
  });
  it('cleans up the exact attachment without treating a missing path as a valid delete', async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'ok' }));
    vi.stubGlobal('fetch', mock);
    await removeChatAttachment(null, scope);
    expect(mock).not.toHaveBeenCalled();
    await removeChatAttachment('attachments/file.txt', scope);
    const request = requestAt(mock);
    expect(request.method).toBe('DELETE');
    expect(await request.json()).toEqual({ path: 'attachments/file.txt', ...scope });
  });
});
