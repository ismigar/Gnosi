import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { calendarDayLink, useDayAgenda, visibleAppointments } from '../../calendar/agenda';
import { ReaderPodcastPlayer } from '../../reader/ReaderPodcastPlayer';
import { useReaderPodcastInfo, useReaderPodcastStatus } from '../../../shared/api/useReaderData';
import { useRequestContext } from '../../../shared/hooks/useRequestContext';
import { getIntlLocale } from '../../../shared/i18n/locales/registry';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { vaultPath } from '../../../shared/routing/vaultRouting';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import type { HomeBlockProps } from '../model';
import './day.css';

function useDayClock() {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        function tick() {
            const time = new Date();
            setNow(time);
            clearTimeout(timer);
            timer = setTimeout(tick, 60_000 - time.getTime() % 60_000);
        }
        timer = setTimeout(tick, 60_000 - Date.now() % 60_000);
        const stop = subscribeWindowEvent('focus', tick);
        return () => { clearTimeout(timer); stop(); };
    }, []);
    return now;
}

function Agenda({ compact }: { readonly compact: boolean }) {
    const { t, i18n } = useTranslation();
    const locale = getIntlLocale(i18n.resolvedLanguage || i18n.language);
    const now = useDayClock();
    const { day, items, hasVisibleCalendars, loading, error, refresh } = useDayAgenda(now);
    const rows = visibleAppointments(items, now, compact);
    const date = now.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' });
    const eventTime = (value: Date) => value.toLocaleString(locale, {
        ...(value.toDateString() === now.toDateString() ? {} : { month: 'short', day: 'numeric' }),
        hour: 'numeric', minute: '2-digit',
    });
    return <div className="home-day">
        <div className="home-day__line">
            <Link className="home-day__date" to={calendarDayLink(day)} aria-label={t('home_canvas.day.open_date', { date })}>
                <time dateTime={day}>{date}</time>
            </Link>
            {error && <RefreshButton label={t('home_canvas.day.retry_agenda')} onClick={() => { void refresh(); }} />}
        </div>
        {rows.length > 0 && <ol className="home-day__appointments">
            {rows.map(row => <li key={JSON.stringify([row.id, row.source, row.start.getTime()])}>
                <Link className={'home-day__appointment home-day__appointment--' + row.state} to={calendarDayLink(day, row.id, row.source, row.instance)}>
                    <span className="home-day__marker" aria-hidden="true" style={{ backgroundColor: row.color }} />
                    <span className="home-day__details">
                        <span className="home-day__timing">
                            {row.allDay ? t('calendar.all_day') : <><time dateTime={row.start.toISOString()}>{eventTime(row.start)}</time>
                                {' – '}<time dateTime={row.end.toISOString()}>{eventTime(row.end)}</time></>}
                            {row.state === 'current' && <strong>{t('home_canvas.day.now')}</strong>}
                            {row.state === 'next' && <strong>{t('home_canvas.day.next')}</strong>}
                        </span>
                        <span className="home-day__name">{row.title}</span>
                    </span>
                </Link>
            </li>)}
        </ol>}
        {loading && <p className="home-block__state" role="status">{t('calendar.loading_events')}</p>}
        {error && <p className="home-block__state" role="status">{t(items.length ? 'home_canvas.day.agenda_partial' : 'home_canvas.day.agenda_error')}</p>}
        {!rows.length && !loading && !error && <p className="home-block__state">
            {t(!hasVisibleCalendars ? 'home_canvas.day.no_calendars' : items.length ? 'home_canvas.day.agenda_done' : 'home_canvas.day.agenda_empty')}
        </p>}
    </div>;
}

function DailyAudio() {
    const { t, i18n } = useTranslation();
    const locale = getIntlLocale(i18n.resolvedLanguage || i18n.language);
    const info = useReaderPodcastInfo(true, 60_000);
    const status = useReaderPodcastStatus();
    const wasRunning = useRef(false);
    const running = status.data?.running === true;
    const refreshInfo = info.refetch;
    useEffect(() => {
        if (wasRunning.current && status.data && !running) void refreshInfo();
        wasRunning.current = running;
    }, [refreshInfo, running, status.data]);
    const episode = info.data?.exists ? info.data : null;
    const created = episode?.created_at ? new Date(episode.created_at) : null;
    const date = created && Number.isFinite(created.getTime()) ? created.toLocaleDateString(locale, { dateStyle: 'long' }) : episode?.formatted_date;
    const loading = info.isPending || status.isPending;
    const error = info.isError || status.isError;
    const lastFailed = Boolean(!running && status.data?.error);
    const counts = /(\d+)\s*(?:\/|of|de|sur)\s*(\d+)/iu.exec(status.data?.progress ?? '');
    return <div className="home-day">
        {error && <div className="home-day__line" role="status"><p className="home-block__state">{t('home_canvas.day.audio_error')}</p>
            <RefreshButton label={t('home_canvas.day.retry_audio')} onClick={() => { void Promise.all([info.refetch(), status.refetch()]); }} />
        </div>}
        {running && <p className="home-block__state" role="status">
            {t('home_canvas.day.generating')}{counts && ` · ${t('home_canvas.day.generation_progress', { done: counts[1], total: counts[2] })}`}
        </p>}
        {lastFailed && <p className="home-block__state" role="status">{t('home_canvas.day.generation_failed')}</p>}
        {episode && <>
            {date && <p className="home-day__meta">{t('home_canvas.day.episode_date', { date })}</p>}
            <ReaderPodcastPlayer info={episode} showResume onRefresh={() => { void refreshInfo(); }} />
        </>}
        {!episode && !running && !error && loading && <p className="home-block__state" role="status">{t('common.loading')}</p>}
        {!episode && !running && !error && !loading && <>
            {!lastFailed && <p className="home-block__state">{t('home_canvas.day.audio_empty')}</p>}
            <Link className="home-day__link" to={vaultPath('reader')}>{t('home_canvas.day.open_reader')}</Link>
        </>}
    </div>;
}

export default function DayBlocks({ block }: HomeBlockProps) {
    const { t } = useTranslation();
    const context = useRequestContext();
    if (!context.vaultId) return <p className="home-block__state">{t('home_canvas.day.select_vault')}</p>;
    const scope = JSON.stringify(context);
    return block.kind === 'agenda' ? <Agenda key={scope} compact={block.width === 1} /> : <DailyAudio key={scope} />;
}
