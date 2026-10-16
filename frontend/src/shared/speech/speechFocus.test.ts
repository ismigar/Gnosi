import { expect, it, vi } from 'vitest';
import { claimSpeechFocus, currentSpeechActivity, subscribeSpeechActivity } from './speechFocus';

it('interrupts an older player and keeps the new lease safe from stale release', () => {
  const stop = vi.fn();
  const first = claimSpeechFocus(stop); first.publish('speaking');
  const second = claimSpeechFocus(() => undefined); second.publish('preparing');
  expect(stop).toHaveBeenCalledOnce();
  first.release(); first.publish('idle');
  expect(currentSpeechActivity()).toBe('preparing');
  second.release(); expect(currentSpeechActivity()).toBe('idle');
});
it('announces preparation and playback so every microphone can suspend', () => {
  const listener = vi.fn(); const unsubscribe = subscribeSpeechActivity(listener);
  const lease = claimSpeechFocus(() => undefined);
  try {
    lease.publish('preparing'); lease.publish('speaking');
    expect(listener).toHaveBeenCalledTimes(2); expect(currentSpeechActivity()).toBe('speaking');
  } finally { lease.release(); unsubscribe(); }
});
