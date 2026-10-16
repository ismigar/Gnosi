import type { ComponentPropsWithoutRef } from 'react';
import { useAudioElementSpeechFocus } from './useAudioElementSpeechFocus';

/** All native audio surfaces share ownership with synthesized speech playback. */
export function AppAudio({ src, onPlay, onPlaying, onWaiting, onPause, onEnded, onError, ...props }: ComponentPropsWithoutRef<'audio'>) {
  const focus = useAudioElementSpeechFocus(src);
  return <audio {...props} ref={focus.ref} src={src}
    onPlay={event => { focus.onPlay(); onPlay?.(event); }}
    onPlaying={event => { focus.onPlaying(); onPlaying?.(event); }}
    onWaiting={event => { focus.onWaiting(); onWaiting?.(event); }}
    onPause={event => { focus.onPause(event); onPause?.(event); }}
    onEnded={event => { focus.onEnded(); onEnded?.(event); }}
    onError={event => { focus.onError(); onError?.(event); }} />;
}
