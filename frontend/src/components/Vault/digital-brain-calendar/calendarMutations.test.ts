import { beforeEach, describe, expect, it, vi } from 'vitest';
import { patchVaultPage } from '../../../shared/api/vaults';
import { updateCalendarEvent } from '../../../shared/api/calendar';
import { toast } from '../../../lib/toast';
import { persistCalendarChange, type CalendarChange } from './calendarMutations';

vi.mock('../../../shared/api/vaults', () => ({ patchVaultPage: vi.fn(() => Promise.resolve({})) }));
vi.mock('../../../shared/api/calendar', () => ({ updateCalendarEvent: vi.fn(() => Promise.resolve({})) }));
vi.mock('../../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../lib/notifyError', () => ({ logError: vi.fn() }));
const translate = (_key: string, fallback: string): string => fallback;

function change(metadata: Record<string, unknown> = {}, allDay = false): CalendarChange {
  return {
    event: { id: 'event', extendedProps: { id: 'event', metadata, readonly: metadata.readonly }, allDay,
      start: new Date(2026, 8, 2, 10, 15, 30), end: new Date(2026, 8, 3, 11, 30, 45),
      startStr: allDay ? '2026-09-02' : '2026-09-02T10:15:30+02:00',
      endStr: allDay ? '2026-09-03' : '2026-09-03T11:30:45+02:00' },
    oldEvent: { startStr: '2026-09-01T10:00:00+02:00' }, revert: vi.fn(),
  };
}

describe('calendar persistence boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('writes vault local clock fields and custom keys without a timezone shift', async () => {
    const info = change();
    const onRefresh = vi.fn();
    await persistCalendarChange(info, 'move', { dateField: 'Planned', endDateField: 'Until', onRefresh }, translate);
    expect(patchVaultPage).toHaveBeenCalledWith('event', { metadata: { Planned: '2026-09-02T10:15:30', Until: '2026-09-03T11:30:45' } });
    expect(info.revert).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('writes an inclusive all-day end while resizing', async () => {
    await persistCalendarChange(change({}, true), 'resize', {}, translate);
    expect(patchVaultPage).toHaveBeenCalledWith('event', { metadata: { end_date: '2026-09-02' } });
  });

  it('keeps provider timestamps and exclusive end dates unchanged', async () => {
    await persistCalendarChange(change({ _provider: 'google', _account: 'test@example.invalid', _calendar_id: 'team' }, true), 'move', {}, translate);
    expect(updateCalendarEvent).toHaveBeenCalledWith({ calendarId: 'team', email: 'test@example.invalid', eventId: 'event',
      event: { start: '2026-09-02', end: '2026-09-03', calendar_id: 'team' } });
    expect(patchVaultPage).not.toHaveBeenCalled();
  });

  it('keeps provider-origin events stored in a vault on the vault persistence path', async () => {
    await persistCalendarChange(change({ _provider: 'google', _account: 'test@example.invalid', _vault_path: '/vault' }), 'move', {}, translate);
    expect(patchVaultPage).toHaveBeenCalledOnce();
    expect(updateCalendarEvent).not.toHaveBeenCalled();
  });

  it.each(['move', 'resize'] as const)('reverts read-only events before %s can persist', async (mode) => {
    const info = change({ readonly: true });
    await persistCalendarChange(info, mode, {}, translate);
    expect(info.revert).toHaveBeenCalledOnce();
    expect(patchVaultPage).not.toHaveBeenCalled();
    expect(updateCalendarEvent).not.toHaveBeenCalled();
  });

  it('delegates a recurring move with the original instance and never patches the series', async () => {
    const info = change({ rrule: 'FREQ=WEEKLY' });
    const onEventEdit = vi.fn();
    await persistCalendarChange(info, 'move', { onEventEdit }, translate);
    expect(info.revert).toHaveBeenCalledOnce();
    expect(onEventEdit).toHaveBeenCalledWith('event', { date: '2026-09-02T10:15:30', end_date: '2026-09-03T11:30:45', instanceStart: '2026-09-01T10:00:00+02:00' }, 'move');
    expect(patchVaultPage).not.toHaveBeenCalled();
  });

  it('delegates recurrence resizing without overwriting the series start', async () => {
    const onEventEdit = vi.fn();
    await persistCalendarChange(change({ recurrence: 'weekly' }), 'resize', { onEventEdit }, translate);
    expect(onEventEdit).toHaveBeenCalledWith('event', { end_date: '2026-09-03T11:30:45', instanceStart: '2026-09-02T10:15:30+02:00' }, 'resize');
  });

  it('warns and reverts when recurrence editing is unavailable', async () => {
    const info = change({ recurrence: 'weekly' });
    await persistCalendarChange(info, 'move', {}, translate);
    expect(info.revert).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith('Recurring events are edited from the main calendar.');
    expect(patchVaultPage).not.toHaveBeenCalled();
  });

  it('reverts failed writes without announcing a refresh', async () => {
    vi.mocked(patchVaultPage).mockRejectedValueOnce(new Error('offline'));
    const info = change();
    const onRefresh = vi.fn();
    await persistCalendarChange(info, 'move', { onRefresh }, translate);
    expect(info.revert).toHaveBeenCalledOnce();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Error moving the event.');
  });
});
