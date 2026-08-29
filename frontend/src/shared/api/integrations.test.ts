import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bulkUpdateIntegrations,
  fetchIntegrations,
  updateCalendarSelection,
  updateDefaultMail,
} from './integrations';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


interface FetchMockCalls {
  readonly mock: { readonly calls: Parameters<typeof fetch>[] };
}


function requestAt(fetchMock: FetchMockCalls, index: number): Request {
  const [input, init] = fetchMock.mock.calls[index] || [];
  return input instanceof Request
    ? input
    : new Request(new URL(String(input), window.location.origin), init);
}


describe('integrations API', () => {
  it('loads masked provider-neutral settings', async () => {
    const payload = { contacts: [{ provider: 'nextcloud' }] };
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload)),
    );

    await expect(fetchIntegrations()).resolves.toEqual(payload);
  });

  it('writes bulk configuration and calendar selection bodies', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json({ status: 'success' })));
    vi.stubGlobal('fetch', fetchMock);

    await bulkUpdateIntegrations({ mail_accounts: [] });
    await updateCalendarSelection({ selection: ['calendar-a'] });

    await expect(requestAt(fetchMock, 0).clone().json()).resolves.toEqual({
      mail_accounts: [],
    });
    await expect(requestAt(fetchMock, 1).clone().json()).resolves.toEqual({
      selection: ['calendar-a'],
    });
  });

  it('writes the selected default mail account', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ status: 'success' }));
    vi.stubGlobal('fetch', fetchMock);

    await updateDefaultMail('mail@example.test');

    const request = requestAt(fetchMock, 0);
    expect(new URL(request.url).pathname).toBe('/api/integrations/default_mail');
    await expect(request.clone().json()).resolves.toEqual({
      email: 'mail@example.test',
    });
  });
});
