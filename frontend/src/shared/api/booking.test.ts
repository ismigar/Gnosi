import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { fetchBookingInfo, fetchBookingSlots, submitBooking } from './booking';

beforeEach(() => {
  resetApiTestStorage();
  writeApiTestStorage('gnosi_active_vault', 'private-visitor-vault');
  writeApiTestStorage('gnosi_workspace_id', 'private-visitor-workspace');
  writeApiTestStorage('gnosi_user_id', 'private-visitor');
  writeApiTestStorage('gnosi_user_email', 'private@example.test');
});
afterEach(() => { resetApiTestStorage(); vi.unstubAllGlobals(); });

describe('public booking API boundary', () => {
  it('uses only the link token and never forwards session or active-vault credentials', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ title: 'Meeting', timezone: 'UTC', duration_minutes: 30, first_date: '2026-10-14', last_date: '2026-11-13' })));
    vi.stubGlobal('fetch', fetchMock);
    await fetchBookingInfo('token-one');
    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected Request');
    expect(request.credentials).toBe('omit');
    expect(request.cache).toBe('no-store');
    expect(request.referrerPolicy).toBe('no-referrer');
    expect(request.headers.has('X-Vault-ID')).toBe(false);
    expect(request.headers.has('X-Workspace-ID')).toBe(false);
    expect(request.headers.has('X-User-ID')).toBe(false);
    expect(request.headers.has('X-User-Email')).toBe(false);
    expect(request.headers.has('Authorization')).toBe(false);
    expect(new URL(request.url).pathname).toBe('/api/booking/public/token-one');
  });

  it('keeps the exact date and durable reservation key in typed requests', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ timezone: 'UTC', date: '2026-10-14', slots: [] })));
    vi.stubGlobal('fetch', fetchMock);
    await fetchBookingSlots('token-one', '2026-10-14');
    const slotsRequest = fetchMock.mock.calls[0]?.[0];
    if (!(slotsRequest instanceof Request)) throw new Error('Expected Request');
    expect(new URL(slotsRequest.url).searchParams.get('date')).toBe('2026-10-14');
    const input = { start: '2026-10-14T09:00:00Z', name: 'Guest', email: 'guest@example.test', idempotency_key: 'stable-request-123' };
    await submitBooking('token-one', input);
    const write = fetchMock.mock.calls[1]?.[0];
    if (!(write instanceof Request)) throw new Error('Expected Request');
    expect(write.method).toBe('POST');
    await expect(write.clone().json()).resolves.toEqual(input);
    expect(write.credentials).toBe('omit');
  });
});
