import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAudioElementSpeechFocus } from './useAudioElementSpeechFocus';
import { currentSpeechActivity } from './speechFocus';

let root: Root; let host: HTMLDivElement;
let mounted = false;
function Probe() { const audio = useAudioElementSpeechFocus('test.mp3'); return <audio {...audio} preload="none" />; }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); root = createRoot(host); mounted = true;
});
afterEach(() => { if (mounted) act(() => { root.unmount(); }); vi.unstubAllGlobals(); });
it('distinguishes pending Reader playback from actual sound and ignores late playback after pause', () => {
  act(() => { root.render(<Probe />); });
  const audio = host.querySelector('audio');
  if (!audio) throw new Error('Missing audio');
  vi.spyOn(audio, 'pause').mockImplementation(() => undefined);
  act(() => { audio.dispatchEvent(new Event('play')); }); expect(currentSpeechActivity()).toBe('preparing');
  act(() => { audio.dispatchEvent(new Event('playing')); }); expect(currentSpeechActivity()).toBe('speaking');
  act(() => { audio.dispatchEvent(new Event('waiting')); }); expect(currentSpeechActivity()).toBe('preparing');
  act(() => { audio.dispatchEvent(new Event('pause')); }); expect(currentSpeechActivity()).toBe('idle');
  act(() => { audio.dispatchEvent(new Event('playing')); }); expect(currentSpeechActivity()).toBe('idle');
});
it('pauses the owned element and releases focus even after React clears its ref on unmount', () => {
  act(() => { root.render(<Probe />); });
  const audio = host.querySelector('audio');
  if (!audio) throw new Error('Missing audio');
  const pause = vi.spyOn(audio, 'pause').mockImplementation(() => undefined);
  act(() => { audio.dispatchEvent(new Event('play')); audio.dispatchEvent(new Event('playing')); });
  act(() => { root.unmount(); }); mounted = false;
  expect(pause).toHaveBeenCalled(); expect(currentSpeechActivity()).toBe('idle');
});
