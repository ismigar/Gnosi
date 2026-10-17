import { useCallback, useEffect, useRef, type SyntheticEvent } from 'react';
import { subscribeAppEvent } from '../platform/app-events';
import { claimSpeechFocus } from './speechFocus';

/** Native audio controls participate in the same focus and microphone suspension. */
export function useAudioElementSpeechFocus(source: string | null | undefined) {
  const element = useRef<HTMLAudioElement | null>(null);
  const bindElement = useCallback((node: HTMLAudioElement | null) => { element.current = node; }, []);
  const playingElement = useRef<HTMLAudioElement | null>(null);
  const lease = useRef<ReturnType<typeof claimSpeechFocus> | undefined>(undefined);
  const stop = useCallback(() => {
    playingElement.current?.pause(); playingElement.current = null;
    lease.current?.release(); lease.current = undefined;
  }, []);
  useEffect(() => {
    const vault = subscribeAppEvent('gnosi:vault-changed', stop);
    const configuration = subscribeAppEvent('gnosi:config-changed', stop);
    return () => { vault(); configuration(); stop(); };
  }, [stop, source]);
  const onPlay = useCallback(() => {
    lease.current?.release();
    playingElement.current = element.current;
    lease.current = claimSpeechFocus(stop); lease.current.publish('preparing');
  }, [stop]);
  const onPlaying = useCallback(() => { lease.current?.publish('speaking'); }, []);
  const onWaiting = useCallback(() => { lease.current?.publish('preparing'); }, []);
  const onPause = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
    if (event.currentTarget.paused || event.currentTarget.ended) { lease.current?.release(); lease.current = undefined; }
  }, []);
  return { ref: bindElement, onPlay, onPlaying, onWaiting, onPause, onEnded: stop, onError: stop };
}
