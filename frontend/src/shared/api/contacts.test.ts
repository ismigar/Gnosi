import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createContact, fetchContacts, syncContacts, updateContact } from './contacts';

afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});

function requestAt(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, index = 0): Request {
  const input: RequestInfo | URL | undefined = fetchMock.mock.calls[index]?.[0];
  if (!(input instanceof Request)) throw new Error('Expected a Request instance');
  return input;
}

const contactPayload = {
  address: null,
  addresses: [],
  apple_resource_id: null,
  company: null,
  created_at: null,
  email: 'ada@example.test',
  emails: [],
  google_resource_name: null,
  id: 'contact-1',
  job_title: null,
  last_synced_at: null,
  name: 'Ada',
  notes: null,
  phone: null,
  phones: [],
  photo_url: null,
  source: 'local',
  tags: [],
  type: 'personal',
  updated_at: null,
  workspace_id: 'personal',
};

describe('contacts API', () => {
  it('queries the generated contact list with optional filters', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json([]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchContacts({ search: 'Ada Lovelace', source: 'google', type: 'b2b' });

    const url = new URL(requestAt(fetchMock).url);
    expect(url.searchParams.get('search')).toBe('Ada Lovelace');
    expect(url.searchParams.get('source')).toBe('google');
    expect(url.searchParams.get('type')).toBe('b2b');
  });

  it('creates and updates contacts with typed request bodies', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(contactPayload, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ ...contactPayload, company: 'Analytical' }));
    vi.stubGlobal('fetch', fetchMock);

    await createContact({ email: 'ada@example.test', name: 'Ada' });
    await updateContact('contact-1', { company: 'Analytical' });

    expect(requestAt(fetchMock).method).toBe('POST');
    await expect(requestAt(fetchMock).clone().json()).resolves.toEqual({
      email: 'ada@example.test',
      name: 'Ada',
    });
    expect(requestAt(fetchMock, 1).method).toBe('PUT');
    expect(new URL(requestAt(fetchMock, 1).url).pathname).toBe(
      '/api/contacts/contact-1',
    );
  });

  it('sends provider-neutral synchronization settings', async () => {
    const payload = {
      result: {
        gnosi_to_remote: {
          created: 0,
          deleted: 0,
          errors: [],
          skipped: 0,
          updated: 0,
        },
        remote_to_gnosi: { errors: [], imported: 0, updated: 0 },
        timestamp: '2026-08-29T10:00:00+00:00',
        vault_export: { errors: [], exported: 0 },
      },
      status: 'ok',
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    vi.stubGlobal('fetch', fetchMock);

    await syncContacts({
      email: 'ada@example.test',
      provider: 'carddav',
      server_url: 'https://cloud.example.test/contacts',
    });

    await expect(requestAt(fetchMock).clone().json()).resolves.toMatchObject({
      provider: 'carddav',
      server_url: 'https://cloud.example.test/contacts',
    });
  });
});
