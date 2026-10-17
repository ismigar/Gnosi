import type { ComponentPropsWithoutRef } from 'react';
import { useAudioElementSpeechFocus } from './useAudioElementSpeechFocus';

/** All native audio surfaces share ownership with synthesized speech playback. */
export function AppAudio({ src, onPlay, onPlaying, onWaiting, onPause, onEnded, onError, ...props }: ComponentPropsWithoutRef<'audio'>) {
  const { ref: audioRef, onPlay: focusPlay, onPlaying: focusPlaying, onWaiting: focusWaiting,
    onPause: focusPause, onEnded: focusEnded, onError: focusError } = useAudioElementSpeechFocus(src);
  return <audio {...props} ref={audioRef} src={src}
    onPlay={event => { focusPlay(); onPlay?.(event); }}
    onPlaying={event => { focusPlaying(); onPlaying?.(event); }}
    onWaiting={event => { focusWaiting(); onWaiting?.(event); }}
    onPause={event => { focusPause(event); onPause?.(event); }}
    onEnded={event => { focusEnded(); onEnded?.(event); }}
    onError={event => { focusError(); onError?.(event); }} />;
}
