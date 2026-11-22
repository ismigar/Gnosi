import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReaderPodcastInfo } from '../../shared/api/reader';
import { useRequestContext } from '../../shared/hooks/useRequestContext';
import { defineStorageKey, jsonStorageCodec, readStorage, removeStorage, writeStorage, type BrowserStorageKey } from '../../shared/platform/browser-storage';
import { AppAudio } from '../../shared/speech/AppAudio';

const positionCodec = jsonStorageCodec((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);

interface PlayerProps {
    readonly info: ReaderPodcastInfo | null;
    readonly src: string;
    readonly showResume?: boolean;
}

function elapsedTime(seconds: number): string {
    const total = Math.floor(seconds);
    const minutes = Math.floor(total / 60);
    return `${String(minutes)}:${String(total % 60).padStart(2, '0')}`;
}

export function ReaderPodcastPlayer({ info, src, showResume }: PlayerProps) {
    const context = useRequestContext();
    const identity = info?.filename || info?.created_at
        ? JSON.stringify([context.workspaceId, context.vaultId, context.userId, context.userEmail, info.filename, info.created_at])
        : '';
    const positionKey = useMemo(() => identity ? defineStorageKey(`gnosi.reader.podcast.position.v1.${identity}`, positionCodec) : null, [identity]);
    return <EpisodeAudio key={JSON.stringify([identity, src])} positionKey={positionKey} src={src} showResume={showResume} />;
}

function EpisodeAudio({ src, positionKey, showResume }: Pick<PlayerProps, 'src' | 'showResume'> & { readonly positionKey: BrowserStorageKey<number> | null }) {
    const { t } = useTranslation();
    const [initialPosition] = useState(() => positionKey ? readStorage(positionKey) ?? 0 : 0);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const element = useRef<HTMLAudioElement | null>(null);
    const restored = useRef(false);
    const lastSaved = useRef(initialPosition);

    const remember = useCallback((audio: HTMLAudioElement, force: boolean) => {
        if (!positionKey || !restored.current || !Number.isFinite(audio.currentTime)) return;
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
        const position = positionKey ? readStorage(positionKey) ?? 0 : 0;
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
            onEnded={() => { if (positionKey) removeStorage(positionKey); }}
            onError={() => { setFailed(true); }}>
            {t('reader_podcast_unsupported')}
        </AppAudio>
        {failed && <p role="status" className="text-xs text-[var(--text-secondary)]">{t('home_canvas.day.playback_error')}</p>}
    </>;
}
