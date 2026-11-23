import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readerEpisodeUrl, type ReaderPodcastInfo } from '../../shared/api/reader';
import { useRequestContext } from '../../shared/hooks/useRequestContext';
import { defineStorageKey, jsonStorageCodec, readStorage, removeStorage, writeStorage, type BrowserStorageKey } from '../../shared/platform/browser-storage';
import { AppAudio } from '../../shared/speech/AppAudio';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';

const positionCodec = jsonStorageCodec((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);

interface PlayerProps {
    readonly info: ReaderPodcastInfo;
    readonly showResume?: boolean;
    readonly onRefresh?: () => void;
}

function elapsedTime(seconds: number): string {
    const total = Math.floor(seconds);
    const minutes = Math.floor(total / 60);
    return `${String(minutes)}:${String(total % 60).padStart(2, '0')}`;
}

export function ReaderPodcastPlayer({ info, showResume, onRefresh }: PlayerProps) {
    const context = useRequestContext();
    const src = readerEpisodeUrl(info);
    const identity = JSON.stringify([context.workspaceId, context.vaultId, context.userId, context.userEmail, info.episode_id]);
    const positionKey = useMemo(() => defineStorageKey(`gnosi.reader.podcast.position.v2.${identity}`, positionCodec), [identity]);
    if (!src) return <Unavailable onRetry={onRefresh} />;
    return <EpisodeAudio key={identity} positionKey={positionKey} src={src} showResume={showResume} onRefresh={onRefresh} />;
}

function Unavailable({ onRetry }: { readonly onRetry?: () => void }) {
    const { t } = useTranslation();
    return <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <span role="status">{t('home_canvas.day.playback_error')}</span>
        {onRetry && <RefreshButton label={t('home_canvas.day.retry_audio')} onClick={onRetry} />}
    </div>;
}

function EpisodeAudio({ src, positionKey, showResume, onRefresh }: {
    readonly src: string;
    readonly positionKey: BrowserStorageKey<number>;
    readonly showResume?: boolean;
    readonly onRefresh?: () => void;
}) {
    const { t } = useTranslation();
    const [initialPosition] = useState(() => readStorage(positionKey) ?? 0);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const element = useRef<HTMLAudioElement | null>(null);
    const restored = useRef(false);
    const lastSaved = useRef(initialPosition);

    const remember = useCallback((audio: HTMLAudioElement, force: boolean) => {
        if (!restored.current || !Number.isFinite(audio.currentTime)) return;
        const position = audio.currentTime;
        if (audio.ended || position <= 0 || (Number.isFinite(audio.duration) && position >= audio.duration)) {
            removeStorage(positionKey);
            lastSaved.current = 0;
        } else if (force || Math.abs(position - lastSaved.current) >= 5) {
            writeStorage(positionKey, position);
            lastSaved.current = position;
        }
    }, [positionKey]);
    useEffect(() => () => {
        if (element.current) remember(element.current, true);
    }, [remember]);

    const restore = (audio: HTMLAudioElement) => {
        element.current = audio;
        if (restored.current) return;
        const position = readStorage(positionKey) ?? 0;
        if (position > 0 && (!Number.isFinite(audio.duration) || position < audio.duration)) {
            try { audio.currentTime = position; } catch { return; }
        }
        restored.current = true;
        setReady(true);
    };

    return <>
        {showResume && !ready && initialPosition > 0 && <p className="home-day__meta">
            {t('home_canvas.day.resume', { position: elapsedTime(initialPosition) })}
        </p>}
        <AppAudio controls preload="none" className="w-full h-8" src={src}
            aria-label={t('reader_podcast_daily')}
            onLoadedMetadata={event => { setFailed(false); restore(event.currentTarget); }}
            onCanPlay={event => { restore(event.currentTarget); }}
            onTimeUpdate={event => { remember(event.currentTarget, false); }}
            onPause={event => { remember(event.currentTarget, true); }}
            onSeeked={event => { remember(event.currentTarget, true); }}
            onEnded={() => { removeStorage(positionKey); }}
            onError={event => {
                element.current = event.currentTarget;
                restored.current = false;
                setFailed(true);
            }}>
            {t('reader_podcast_unsupported')}
        </AppAudio>
        {failed && <Unavailable onRetry={() => {
            onRefresh?.();
            element.current?.load();
        }} />}
    </>;
}
