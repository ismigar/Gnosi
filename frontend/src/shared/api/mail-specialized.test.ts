import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchRemoteMailImage,
  mailAttachmentUrl,
  mailCidUrl,
  mailEventsUrl,
  replyMailMultipart,
  sendMailMultipart,
} from './mail-specialized';

afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});

describe('specialized mail transports', () => {
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

    expect(image?.type).toBe('image/png');
    expect(image?.size).toBe(3);
    const [input, init] = fetchMock.mock.calls[0] || [];
    const request = input instanceof Request
      ? input
      : new Request(new URL(String(input), window.location.origin), init);
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({
      url: 'https://images.example.test/a.png',
    });
  });
});
