import { resetApiTestStorage } from '../../../tests/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchGoogleOAuthHealth, fetchGoogleOAuthStatus, googleSignInPath } from './google-auth';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('Google OAuth API', () => {
  it('forwards the entered email without changing plus aliases or adding query parameters', () => {
    const url = new URL(googleSignInPath('calendar', ' User+calendar@example.test '), 'http://localhost');
    expect(url.pathname).toBe('/api/auth/google/login');
    expect([...url.searchParams.entries()]).toEqual([
      ['type', 'calendar'], ['login_hint', 'User+calendar@example.test'],
    ]);
    const unusual = new URL(googleSignInPath('mail', 'user&other=value@example.test'), 'http://localhost');
    expect(unusual.searchParams.get('login_hint')).toBe('user&other=value@example.test');
    expect(unusual.searchParams.has('other')).toBe(false);
    expect(googleSignInPath('calendar', ' ')).toBe('/api/auth/google/login?type=calendar');
  });

  it('loads the minimal OAuth status through the generated client', async () => {
    const payload = {
      client_id: 'client.apps.googleusercontent.com',
      configured: true,
    };
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(payload, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchGoogleOAuthStatus()).resolves.toEqual(payload);
    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    expect(request.method).toBe('GET');
    expect(new URL(request.url).pathname).toBe('/api/auth/google/status');
  });


  it('loads OAuth diagnostics and forwards cancellation', async () => {
    const payload = {
      app_status: 'healthy',
      client_id_present: true,
      configured: true,
      google_accounts_recently_failed: 0,
      google_accounts_total: 2,
      google_accounts_with_refresh_token: 2,
      hint: 'Google OAuth is healthy.',
      publish_guide: '/docs/dev_memory/directives/publish_google_app.md',
      scopes: ['openid'],
    };
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(payload, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchGoogleOAuthHealth(controller.signal)).resolves.toEqual(
      payload,
    );
    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    expect(request.method).toBe('GET');
    expect(new URL(request.url).pathname).toBe('/api/auth/google/health');
    expect(request.signal.aborted).toBe(false);
    controller.abort();
    expect(request.signal.aborted).toBe(true);
  });
});
