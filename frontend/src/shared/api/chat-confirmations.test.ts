import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelChatAction, confirmationRecord, confirmChatAction, fetchChatConfirmations, fetchChatConfirmationStatus } from './chat-confirmations';

const scope = { agent_id: 'agent a', session_id: 'session/b' };
afterEach(() => { vi.unstubAllGlobals(); });

function requestAt(mock: ReturnType<typeof vi.fn<typeof fetch>>, index = 0): Request {
  const input = mock.mock.calls[index]?.[0];
  if (!(input instanceof Request)) throw new Error('Expected the generated client to construct a Request');
  return input;
}

describe('typed confirmation HTTP boundary', () => {
  it('refines public fields and preserves opaque action details', () => {
    expect(confirmationRecord(null)).toBeNull();
    expect(confirmationRecord({ confirmation_id: 3 })).toBeNull();
    const record = confirmationRecord({ confirmation_id: 'a', status: 'pending', details: { body: 'private', future: [1] }, future_metadata: true });
    expect(record?.details).toEqual({ body: 'private', future: [1] });
    expect(record?.future_metadata).toBe(true);
    expect(confirmationRecord({ confirmation_id: 'a', status: 5, details: [] })?.status).toBeUndefined();
  });

  it('encodes the exact scope and ignores invalid cards without losing valid cards', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ confirmations: [null, { confirmation_id: 4 }, { confirmation_id: 'a', status: 'pending' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const abort = new AbortController();
    const result = await fetchChatConfirmations(scope, abort.signal);
    expect(result?.map((card) => card.confirmation_id)).toEqual(['a']);
    const request = requestAt(fetchMock);
    const url = new URL(request.url);
    expect(url.pathname).toBe('/api/chat/confirmations');
    expect(Object.fromEntries(url.searchParams)).toEqual(scope);
    abort.abort();
    expect(request.signal.aborted).toBe(true);
  });

  it('distinguishes unsuccessful status reads from terminal public results', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ detail: 'not found' }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ status: 'partial', result: { updated_count: 2 } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchChatConfirmationStatus('action/a', scope)).resolves.toBeNull();
    await expect(fetchChatConfirmationStatus('action/a', scope)).resolves.toMatchObject({ status: 'partial', result: { updated_count: 2 } });
    expect(new URL(requestAt(fetchMock).url).pathname).toBe('/api/chat/confirmations/action%2Fa');
  });

  it('sends one scoped execution and preserves success with an empty legacy body', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('not json'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(confirmChatAction('action', scope)).resolves.toMatchObject({ ok: true, payload: { status: undefined, result: {} } });
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = requestAt(fetchMock);
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual(scope);
    expect(new URL(request.url).pathname).toBe('/api/chat/confirmations/action/confirm');
  });

  it('retains structured HTTP errors and accepts cancellation without a response body', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ detail: { code: 'confirmation_outcome_unknown' } }, { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(confirmChatAction('action', scope)).resolves.toMatchObject({ ok: false, payload: { detail: { code: 'confirmation_outcome_unknown' } } });
    await expect(cancelChatAction('action', scope)).resolves.toBe(true);
    const request = requestAt(fetchMock, 1);
    expect(await request.json()).toEqual(scope);
    expect(new URL(request.url).pathname).toBe('/api/chat/confirmations/action/cancel');
  });
});
