import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createBookingLink, fetchBookingAvailability, fetchBookingLinks, revokeBookingLink, type BookingLink, type BookingSlots } from '../../shared/api/booking';
import { useActiveVaultId } from '../../shared/hooks/useActiveVaultId';
import { writeClipboardText } from '../../shared/platform/clipboard';
import { toast } from '../../shared/notifications/toast';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import { BookingScheduleFields, bookingInputClass } from './BookingScheduleFields';
import { bookingCalendars, calendarKey, defaultSchedule, formatSlot, localDate, type BookingCalendarConfig } from './bookingModel';

export default function BookingManager({ calendars }: { calendars: readonly BookingCalendarConfig[] }) {
  const vaultId = useActiveVaultId();
  return <BookingManagerContent key={vaultId} calendars={calendars} />;
}

function BookingManagerContent({ calendars }: { calendars: readonly BookingCalendarConfig[] }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const choices = useMemo(() => bookingCalendars(calendars, t('booking.vault', 'Gnosi calendar')), [calendars, t]);
  const [schedule, setSchedule] = useState(() => defaultSchedule(choices));
  const [date, setDate] = useState(localDate);
  const [destinationKey, setDestinationKey] = useState(choices[0]?.key ?? '');
  const [title, setTitle] = useState('');
  const [expiresDays, setExpiresDays] = useState(30);
  const [links, setLinks] = useState<BookingLink[]>([]);
  const [slots, setSlots] = useState<BookingSlots | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const scheduleRevision = useRef(0);
  const selected = choices.filter(choice => schedule.calendars.some(calendar => calendarKey(calendar) === choice.key));
  const destination = selected.find(choice => choice.key === destinationKey) ?? selected[0];

  const loadLinks = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    try { setLinks(await fetchBookingLinks(signal)); }
    catch { if (!signal?.aborted) toast.error(t('booking.loadError', 'Could not load booking links.')); }
    finally { if (!signal?.aborted) setRefreshing(false); }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchBookingLinks(controller.signal).then(result => { if (!controller.signal.aborted) setLinks(result); })
      .catch(() => { if (!controller.signal.aborted) toast.error(t('booking.loadError', 'Could not load booking links.')); })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => { controller.abort(); };
  }, [t]);

  const check = async () => {
    const revision = scheduleRevision.current;
    setBusy(true);
    setSlots(null);
    try {
      const result = await fetchBookingAvailability(date, schedule);
      if (scheduleRevision.current === revision) setSlots(result);
    }
    catch { toast.error(t('booking.availabilityError', 'Availability could not be verified. Check the selected calendars and schedule.')); }
    finally { setBusy(false); }
  };

  const create = async () => {
    if (!destination) return;
    setBusy(true);
    try {
      const link = await createBookingLink({ title, schedule, destination: destination.calendar, expires_days: expiresDays });
      setLinks(current => [link, ...current]);
      toast.success(t('booking.created', 'Booking link created.'));
    } catch { toast.error(t('booking.createError', 'Could not create the link. Check the schedule and calendar permissions.')); }
    finally { setBusy(false); }
  };

  const copy = async (link: BookingLink) => {
    try {
      await writeClipboardText(new URL(`/book/${link.token}`, window.location.origin).href);
      toast.success(t('booking.copied', 'Link copied.'));
    } catch { toast.error(t('booking.copyError', 'Could not copy the link.')); }
  };

  const revoke = async (link: BookingLink) => {
    setBusy(true);
    try {
      await revokeBookingLink(link.id);
      setLinks(current => current.map(item => item.id === link.id ? { ...item, revoked: true } : item));
    } catch { toast.error(t('booking.revokeError', 'Could not revoke the link.')); }
    finally { setBusy(false); }
  };

  return <div className="p-5 space-y-6 text-[var(--text-primary)]">
    <h3 className="font-semibold">{t('booking.title', 'Availability and bookings')}</h3>
    <p className="text-xs text-[var(--text-secondary)]">{t('booking.aggregateHelp', 'A time is available only when every selected calendar is free. Failed calendar checks block reservations.')}</p>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void check(); }}>
      <BookingScheduleFields choices={choices} value={schedule} onChange={value => { scheduleRevision.current += 1; setSchedule(value); setSlots(null); }} />
      <label className="block text-xs" htmlFor={`${id}-date`}>{t('booking.date', 'Date')}
        <input id={`${id}-date`} type="date" className={bookingInputClass} value={date} onChange={event => { scheduleRevision.current += 1; setDate(event.target.value); setSlots(null); }} required />
      </label>
      <button className="btn btn-gnosi-primary w-full" disabled={busy || selected.length === 0}>{t('booking.check', 'Check availability')}</button>
    </form>
    {slots && <div className="space-y-2" role="status">
      <p className="text-xs">{slots.timezone}</p>
      {slots.slots.length === 0 && <p className="text-sm">{t('booking.noSlots', 'No available times on this date.')}</p>}
      <div className="grid grid-cols-1 gap-2">{slots.slots.map(slot => <span key={slot.start} className="text-sm">{formatSlot(slot.start, slot.end, slots.timezone, i18n.language)}</span>)}</div>
    </div>}
    <form className="space-y-3 pt-4 border-t border-[var(--border-primary)]" onSubmit={event => { event.preventDefault(); void create(); }}>
      <h4 className="font-medium">{t('booking.publicLink', 'Public booking link')}</h4>
      <label className="block text-xs" htmlFor={`${id}-title`}>{t('booking.meetingTitle', 'Meeting title')}
        <input id={`${id}-title`} className={bookingInputClass} value={title} maxLength={160} onChange={event => { setTitle(event.target.value); }} required />
      </label>
      <label className="block text-xs" htmlFor={`${id}-destination`}>{t('booking.destination', 'Save reservations in')}
        <select id={`${id}-destination`} className={bookingInputClass} value={destination?.key ?? ''} onChange={event => { setDestinationKey(event.target.value); }} required>
          {selected.map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
        </select>
      </label>
      <label className="block text-xs" htmlFor={`${id}-expires`}>{t('booking.expires', 'Link lifetime (days)')}
        <input id={`${id}-expires`} type="number" min="1" max="90" className={bookingInputClass} value={expiresDays} onChange={event => { setExpiresDays(Number(event.target.value)); }} required />
      </label>
      <p className="text-xs text-[var(--text-secondary)]">{t('booking.reachable', 'Guests need access to this Gnosi server. Keep it running and share a reachable address; a localhost link works only on your computer.')}</p>
      <button className="btn btn-gnosi-primary w-full" disabled={busy || !destination}>{t('booking.createLink', 'Create booking link')}</button>
    </form>
    <section className="space-y-3">
      <div className="flex items-center justify-between"><h4 className="font-medium">{t('booking.links', 'Your links')}</h4><RefreshButton loading={refreshing} onClick={() => { void loadLinks(); }} /></div>
      {links.map(link => <article key={link.id} className="p-3 rounded-lg border border-[var(--border-primary)] space-y-2">
        <p className="text-sm font-medium">{link.title}</p>
        <p className="text-xs text-[var(--text-secondary)]">{link.revoked ? t('booking.revoked', 'Revoked') : t('booking.expiresOn', 'Expires {{date}}', { date: new Date(link.expires_at).toLocaleDateString(i18n.language) })}</p>
        {!!link.pending_reservations && <p className="text-xs" role="status">{t('booking.pendingOwner', '{{count}} reservation(s) need confirmation. Their time remains blocked; check the destination calendar before making another booking.', { count: link.pending_reservations })}</p>}
        {!link.revoked && <div className="flex gap-2"><button className="btn btn-sm" onClick={() => { void copy(link); }}>{t('booking.copy', 'Copy link')}</button><button className="btn btn-sm" disabled={busy} onClick={() => { void revoke(link); }}>{t('booking.revoke', 'Revoke')}</button></div>}
      </article>)}
    </section>
  </div>;
}
