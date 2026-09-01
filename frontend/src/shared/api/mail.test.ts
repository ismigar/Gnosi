import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createMailView,
  deleteMailTag,
  fetchMailMessages,
  moveMailMessage,
  saveMailDraft,
  setMailMessageTags,
  starMailMessage,
} from './mail';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

function requestAt(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, index = 0): Request {
  const input: RequestInfo | URL | undefined = fetchMock.mock.calls[index]?.[0];
  if (!(input instanceof Request)) throw new Error('Expected a Request instance');
  return input;
}

describe('mail API', () => {
  it('queries messages with provider-neutral pagination and filters', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ messages: [], next_page_token: null, total: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchMailMessages({
      email: 'ada@example.test',
      folder: 'Archive',
      force: true,
      limit: 25,
      offset: 50,
      pageToken: 'next',
      search: 'research',
    });

    const url = new URL(requestAt(fetchMock).url);
    expect(url.searchParams.get('email')).toBe('ada@example.test');
    expect(url.searchParams.get('folder')).toBe('Archive');
    expect(url.searchParams.get('force')).toBe('true');
    expect(url.searchParams.get('page_token')).toBe('next');
    expect(url.searchParams.get('search')).toBe('research');
  });

  it('materializes compatibility defaults when saving a draft', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ draft_id: 'draft-1', imap_uid: null, status: 'success' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await saveMailDraft({ account: 'ada@example.test', subject: 'Research' });

    await expect(requestAt(fetchMock).clone().json()).resolves.toEqual({
      account: 'ada@example.test',
      bcc: '',
      body: '',
      cc: '',
      subject: 'Research',
      to: '',
    });
  });

  it('moves and stars one message through generated paths', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: 'success' }))
      .mockResolvedValueOnce(Response.json({ status: 'success' }));
    vi.stubGlobal('fetch', fetchMock);

    await moveMailMessage('imap_42', 'ada@example.test', {
      target_folder: 'Archive',
    });
    await starMailMessage('imap_42', 'ada@example.test', true);

    expect(new URL(requestAt(fetchMock).url).pathname).toBe(
      '/api/mail/messages/imap_42/move',
    );
    await expect(requestAt(fetchMock).clone().json()).resolves.toEqual({
      target_folder: 'Archive',
    });
    await expect(requestAt(fetchMock, 1).clone().json()).resolves.toEqual({
      starred: true,
    });
  });

  it('materializes defaults for view creation without altering its name', async () => {
    const payload = {
      actions: [],
      created_at: null,
      fields: [],
      filter_logic: 'AND',
      filters: [],
      group_by: 'none',
      id: 'view-1',
      name: 'Research',
      sort_by: 'date',
      sort_dir: 'desc',
      updated_at: null,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(payload, { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createMailView({ name: 'Research' });

    await expect(requestAt(fetchMock).clone().json()).resolves.toMatchObject({
      filter_logic: 'AND',
      group_by: 'none',
      name: 'Research',
      sort_by: 'date',
      sort_dir: 'desc',
    });
  });

  it('sets message tags with stable legacy metadata defaults', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ status: 'success', tag_ids: ['tag-1'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await setMailMessageTags('message-1', { tag_ids: ['tag-1'] });

    await expect(requestAt(fetchMock).clone().json()).resolves.toEqual({
      account_email: '',
      date_str: '',
      sender: '',
      subject: '',
      tag_ids: ['tag-1'],
    });
  });

  it('accepts intentional 204 tag deletion responses', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteMailTag('tag-1')).resolves.toBeUndefined();
  });
});
