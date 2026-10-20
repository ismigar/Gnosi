import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchRemoteMailImage,
  mailAttachmentUrl,
  mailCidUrl,
  mailEventsUrl,
  MAIL_SUBMISSION_TIMEOUT_MS,
  MailSubmissionError,
  replyMailMultipart,
  sendMailMultipart,
} from './mail-specialized';

afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('specialized mail transports', () => {
  it.each(['headers', 'body', 'ignored-abort'] as const)(
    'bounds stalled send %s and does not retry or accept a late result', async (stage) => {
      vi.useFakeTimers();
      let resolveLate: ((value: Response) => void) | undefined;
      let bodyCancelled = false;
      const fetchMock = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
        if (stage === 'body') return Promise.resolve(new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{'));
            init?.signal?.addEventListener('abort', () => {
              bodyCancelled = true;
              controller.error(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
          },
        })));
        return new Promise<Response>((resolve, reject) => {
          resolveLate = resolve;
          if (stage === 'headers') init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      const pending = sendMailMultipart('ada@example.test', new FormData());
      const result = pending.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(MAIL_SUBMISSION_TIMEOUT_MS);
      expect(await result).toMatchObject({ reason: 'unknown' });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      if (stage === 'body') expect(bodyCancelled).toBe(true);
      resolveLate?.(Response.json({ status: 'success' }));
      await Promise.resolve();
      expect(await result).toBeInstanceOf(MailSubmissionError);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('bounds reply, forwards cancellation, and preserves explicit API rejection', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);
    const pending = replyMailMultipart('message-1', 'ada@example.test', 'INBOX', new FormData(), {
      signal: controller.signal,
    }).catch((error: unknown) => error);
    controller.abort();
    expect(await pending).toMatchObject({ reason: 'unknown' });
    expect(vi.getTimerCount()).toBe(0);
    fetchMock.mockResolvedValueOnce(Response.json({ detail: 'Missing BODY' }, { status: 400 }));
    await expect(sendMailMultipart('ada@example.test', new FormData())).rejects.toMatchObject({
      status: 400, payload: { detail: 'Missing BODY' },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['mail_delivery_unknown', 504, 'unknown'],
    ['mail_send_in_progress', 409, 'in_progress'],
  ] as const)('retains mail submission outcome %s', async (code, status, reason) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ detail: { code } }, { status }),
    ));
    await expect(sendMailMultipart('ada@example.test', new FormData())).rejects.toMatchObject({ reason });
  });

  it('builds encoded SSE, attachment and CID URLs in one boundary', () => {
    expect(mailEventsUrl('ada+mail@example.test')).toBe(
      '/api/mail/events?email=ada%2Bmail%40example.test',
    );
    const attachment = new URL(
      mailAttachmentUrl('message/1', 'part 2', 'ada@example.test', {
        contentType: 'application/pdf',
        filename: 'paper 1.pdf',
        folder: 'All Mail',
        inline: true,
      }),
      'https://gnosi.local',
    );
    expect(attachment.pathname).toBe(
      '/api/mail/messages/message%2F1/attachments/part%202',
    );
    expect(attachment.searchParams.get('filename')).toBe('paper 1.pdf');
    expect(attachment.searchParams.get('inline')).toBe('true');
    expect(mailCidUrl('message/1', '<image 1>', 'ada@example.test')).toContain(
      '/cid/%3Cimage%201%3E',
    );
  });

  it('posts send and reply FormData through the reviewed multipart adapter', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: 'success' }))
      .mockResolvedValueOnce(Response.json({ status: 'success' }));
    vi.stubGlobal('fetch', fetchMock);
    const body = new FormData();
    body.set('body', 'Hello');

    await sendMailMultipart('ada@example.test', body);
    await replyMailMultipart('message-1', 'ada@example.test', 'Sent Items', body);

    const requests = fetchMock.mock.calls.map(([input, init]) =>
      input instanceof Request
        ? input
        : new Request(new URL(String(input), window.location.origin), init),
    );
    expect(requests[0]?.method).toBe('POST');
    expect(new URL(requests[0]?.url || '').pathname).toBe('/api/mail/send');
    expect(new URL(requests[1]?.url || '').pathname).toBe(
      '/api/mail/messages/message-1/reply',
    );
    expect(new URL(requests[1]?.url || '').searchParams.get('folder')).toBe(
      'Sent Items',
    );
  });

  it('loads validated remote mail images through the reviewed binary adapter', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const image = await fetchRemoteMailImage('https://images.example.test/a.png');

    expect(image.type).toBe('image/png');
    expect(image.size).toBe(3);
    const [input, init] = fetchMock.mock.calls[0] || [];
    const request = input instanceof Request
      ? input
      : new Request(new URL(String(input), window.location.origin), init);
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({
      url: 'https://images.example.test/a.png',
    });
  });

  it.each([
    ['blocked_url', 'blocked'],
    ['timeout', 'timeout'],
    ['image_too_large', 'too_large'],
    ['invalid_image', 'unsupported'],
    ['origin_unavailable', 'unavailable'],
  ] as const)('retains safe remote image failure %s as %s', async (detail, reason) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ detail }, { status: 502 }),
    ));

    const request = fetchRemoteMailImage('https://images.example.test/a.png');

    await expect(request).rejects.toMatchObject({
      reason,
    });
  });
});
