import { useEffect, useId, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchBookingInfo, fetchBookingSlots, submitBooking, type BookingInfo, type BookingReservation, type BookingReservationInput, type BookingSlots } from '../../shared/api/booking';
import { GnosiApiError } from '../../shared/api/errors';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import { bookingInputClass } from './BookingScheduleFields';
import { formatSlot } from './bookingModel';
import { bookingIdentity, clearPendingBooking, readPendingBooking, savePendingBooking } from './bookingIdentity';

export default function BookingPage() {
  const { token = '' } = useParams<{ token: string }>();
  return <BookingContent key={token} token={token} />;
}

function BookingContent({ token }: { token: string }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [pending] = useState(() => readPendingBooking(token));
  const [info, setInfo] = useState<BookingInfo | null>(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<BookingSlots | null>(null);
  const [start, setStart] = useState(pending?.request.start ?? '');
  const [name, setName] = useState(pending?.request.name ?? '');
  const [email, setEmail] = useState(pending?.request.email ?? '');
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [reservation, setReservation] = useState<BookingReservation | null>(null);
  const [reload, setReload] = useState(0);
  const request = useRef<BookingReservationInput | null>(pending?.request ?? null);
  const [hasRequest, setHasRequest] = useState(Boolean(pending));

  useEffect(() => {
    const controller = new AbortController();
    void fetchBookingInfo(token, controller.signal).then(value => {
      if (!controller.signal.aborted) { setInfo(value); setDate(pending?.date ?? value.first_date); setLoadingSlots(!pending); }
    }).catch(() => {
      if (!controller.signal.aborted) setError(t('booking.unavailable', 'This booking link is unavailable or has expired.'));
    }).finally(() => { if (!controller.signal.aborted) setLoadingInfo(false); });
    return () => { controller.abort(); };
  }, [token, t, pending]);

  useEffect(() => {
    if (!info || !date || hasRequest) return;
    const controller = new AbortController();
    void fetchBookingSlots(token, date, controller.signal).then(value => {
      if (!controller.signal.aborted) setSlots(value);
    }).catch(() => {
      if (!controller.signal.aborted) setError(t('booking.availabilityError', 'Availability could not be verified. Check the selected calendars and schedule.'));
    }).finally(() => { if (!controller.signal.aborted) setLoadingSlots(false); });
    return () => { controller.abort(); };
  }, [date, info, reload, t, token, hasRequest]);

  const refreshSlots = () => {
    setLoadingSlots(true); setSlots(null); setStart(''); setReload(current => current + 1);
  };

  const reserve = async () => {
    if (!start && !request.current) return;
    request.current ??= { start, name: name.trim(), email: email.trim(), idempotency_key: bookingIdentity() };
    savePendingBooking(token, { date, request: request.current });
    setHasRequest(true);
    setLoadingSlots(false);
    setSending(true);
    setError('');
    try {
      const result = await submitBooking(token, request.current);
      setReservation(result);
      if (result.status !== 'pending') clearPendingBooking(token);
    }
    catch (caught) {
      if (caught instanceof GnosiApiError && caught.status === 409) {
        request.current = null;
        clearPendingBooking(token); setHasRequest(false);
        setError(t('booking.conflict', 'This time is no longer available. Choose another time.'));
        refreshSlots();
      } else if (caught instanceof GnosiApiError && [400, 413, 422].includes(caught.status)) {
        request.current = null;
        clearPendingBooking(token); setHasRequest(false);
        setError(t('booking.validationError', 'Check your name, email and chosen time before trying again.'));
      } else if (caught instanceof GnosiApiError && caught.status === 404) {
        request.current = null;
        clearPendingBooking(token); setHasRequest(false);
        setInfo(null);
        setError(t('booking.unavailable', 'This booking link is unavailable or has expired.'));
      } else {
        setError(t('booking.retrySame', 'The result is not confirmed. Retry this same request to check it without creating a duplicate.'));
      }
    } finally { setSending(false); }
  };

  const locked = sending || hasRequest;
  const loading = loadingInfo || loadingSlots;
  return <main className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] p-6">
    <section className="max-w-xl mx-auto space-y-5 rounded-xl border border-[var(--border-primary)] p-6">
      <div className="flex items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{info?.title ?? t('booking.publicHeading', 'Book a time')}</h1>{info && !locked && <RefreshButton loading={loading} onClick={refreshSlots} />}</div>
      {loading && <p role="status">{t('booking.loading', 'Checking availability…')}</p>}
      {error && <p role="alert" className="text-sm">{error}</p>}
      {reservation ? <div role="status" className="space-y-3">
        <p className="font-medium">{reservation.status === 'confirmed' ? t('booking.confirmed', 'Your reservation is confirmed.') : reservation.status === 'pending' ? t('booking.pending', 'Your request is recorded but calendar confirmation is pending. This time remains reserved; please contact the organizer before making another booking.') : t('booking.failed', 'The calendar rejected the reservation. Please contact the organizer.')}</p>
        {info && <p>{formatSlot(reservation.start, reservation.end, info.timezone, i18n.language)}</p>}
        {reservation.status === 'pending' && <button className="btn" disabled={sending} onClick={() => { void reserve(); }}>{t('booking.checkRequest', 'Check this request')}</button>}
      </div> : info && <form className="space-y-5" onSubmit={event => { event.preventDefault(); void reserve(); }}>
        <p className="text-sm text-[var(--text-secondary)]">{t('booking.publicDuration', '{{minutes}} minutes · {{timezone}}', { minutes: info.duration_minutes, timezone: info.timezone })}</p>
        <label className="block text-sm" htmlFor={`${id}-date`}>{t('booking.date', 'Date')}
          <input id={`${id}-date`} className={bookingInputClass} type="date" min={info.first_date} max={info.last_date} value={date} disabled={locked} onChange={event => { setDate(event.target.value); setError(''); refreshSlots(); }} required />
        </label>
        {slots?.slots.length === 0 && <p>{t('booking.noSlots', 'No available times on this date.')}</p>}
        <fieldset disabled={locked} className="space-y-2"><legend className="text-sm mb-2">{t('booking.chooseTime', 'Choose a time')}</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{slots?.slots.map(slot => <button key={slot.start} type="button" aria-pressed={start === slot.start} className={`btn ${start === slot.start ? 'btn-gnosi-primary' : ''}`} onClick={() => { setStart(slot.start); }}>{formatSlot(slot.start, slot.end, info.timezone, i18n.language)}</button>)}</div>
        </fieldset>
        <label className="block text-sm" htmlFor={`${id}-name`}>{t('booking.name', 'Your name')}
          <input id={`${id}-name`} className={bookingInputClass} value={name} maxLength={120} autoComplete="name" disabled={locked} onChange={event => { setName(event.target.value); }} required />
        </label>
        <label className="block text-sm" htmlFor={`${id}-email`}>{t('booking.email', 'Email')}
          <input id={`${id}-email`} className={bookingInputClass} type="email" value={email} maxLength={254} autoComplete="email" disabled={locked} onChange={event => { setEmail(event.target.value); }} required />
        </label>
        <button className="btn btn-gnosi-primary w-full" disabled={sending || (!start && !hasRequest)}>{hasRequest ? t('booking.retry', 'Retry the same request') : t('booking.reserve', 'Confirm reservation')}</button>
      </form>}
    </section>
  </main>;
}
