import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import BookingPage from './BookingPage';
import { fetchBookingInfo, fetchBookingSlots, submitBooking } from '../../shared/api/booking';
import { GnosiApiError } from '../../shared/api/errors';
import { clearPendingBooking } from './bookingIdentity';

vi.mock('../../shared/api/booking', () => ({ fetchBookingInfo: vi.fn(), fetchBookingSlots: vi.fn(), submitBooking: vi.fn() }));
vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key;
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

let container: HTMLDivElement;
let root: Root;
function Harness() {
  const navigate = useNavigate();
  return <><button onClick={() => { void navigate('/book/second-token'); }}>Another link</button><Routes><Route path="/book/:token" element={<BookingPage />} /></Routes></>;
}

beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.mocked(fetchBookingInfo).mockResolvedValue({ title: 'Consultation', timezone: 'UTC', duration_minutes: 30, first_date: '2026-10-14', last_date: '2026-11-13' });
  vi.mocked(fetchBookingSlots).mockResolvedValue({ date: '2026-10-14', timezone: 'UTC', slots: [{ start: '2026-10-14T09:00:00Z', end: '2026-10-14T09:30:00Z' }] });
  vi.mocked(submitBooking).mockResolvedValue({ id: 'r1', status: 'confirmed', start: '2026-10-14T09:00:00Z', end: '2026-10-14T09:30:00Z' });
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); clearPendingBooking('first-token'); clearPendingBooking('second-token'); vi.resetAllMocks(); });

async function render() { await act(async () => { root.render(<MemoryRouter initialEntries={['/book/first-token']}><Harness /></MemoryRouter>); await Promise.resolve(); }); }
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent.includes(text));
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => { button.click(); await Promise.resolve(); });
}
async function fill(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`Missing input: ${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}
async function enterReservation() {
  await click('09:00');
  await fill('input[autocomplete=name]', 'Guest');
  await fill('input[type=email]', 'guest@example.test');
}

describe('public reservation form', () => {
  it('retries an unknown response with the same key and frozen payload', async () => {
    vi.mocked(submitBooking).mockRejectedValueOnce(new Error('network response lost'));
    await render(); await enterReservation(); await click('Confirm reservation');
    expect(container.querySelector<HTMLInputElement>('input[type=email]')?.disabled).toBe(true);
    await click('Retry the same request');
    expect(submitBooking).toHaveBeenCalledTimes(2);
    expect(vi.mocked(submitBooking).mock.calls[1]).toEqual(vi.mocked(submitBooking).mock.calls[0]);
    expect(container.textContent).toContain('Your reservation is confirmed.');
  });

  it('unlocks rejected validation so the guest can correct it', async () => {
    vi.mocked(submitBooking).mockRejectedValueOnce(new GnosiApiError(new Response(null, { status: 422 }), { detail: 'Invalid email' }));
    await render(); await enterReservation(); await click('Confirm reservation');
    expect(container.querySelector<HTMLInputElement>('input[type=email]')?.disabled).toBe(false);
    expect(container.textContent).toContain('Check your name, email and chosen time');
  });

  it('forgets the previous reservation when a different public token is opened', async () => {
    vi.mocked(submitBooking).mockResolvedValueOnce({ id: 'r1', status: 'pending', start: '2026-10-14T09:00:00Z', end: '2026-10-14T09:30:00Z' });
    await render(); await enterReservation(); await click('Confirm reservation');
    expect(container.textContent).toContain('Your request is recorded');
    await click('Another link');
    expect(container.textContent).not.toContain('Your request is recorded');
    expect(container.querySelector<HTMLInputElement>('input[type=email]')?.value).toBe('');
    expect(submitBooking).toHaveBeenCalledTimes(1);
    expect(fetchBookingInfo).toHaveBeenLastCalledWith('second-token', expect.any(AbortSignal));
  });

  it('restores an uncertain request after reload and keeps its original key', async () => {
    vi.mocked(submitBooking).mockRejectedValueOnce(new Error('network response lost'));
    await render(); await enterReservation(); await click('Confirm reservation');
    const first = vi.mocked(submitBooking).mock.calls[0];
    await act(async () => { root.unmount(); await Promise.resolve(); });
    root = createRoot(container);
    await render();
    expect(container.querySelector<HTMLInputElement>('input[type=email]')?.value).toBe('guest@example.test');
    await click('Retry the same request');
    expect(vi.mocked(submitBooking).mock.calls[1]).toEqual(first);
  });
});
