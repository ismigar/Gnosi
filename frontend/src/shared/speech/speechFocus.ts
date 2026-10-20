export type SpeechActivity = 'idle' | 'preparing' | 'speaking';
let activity: SpeechActivity = 'idle';
let owner: symbol | undefined;
let cancel: (() => void) | undefined;
const listeners = new Set<() => void>();

function publish(value: SpeechActivity) {
  if (value === activity) return;
  activity = value;
  for (const listener of listeners) listener();
}
export function subscribeSpeechActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function currentSpeechActivity(): SpeechActivity { return activity; }

/** Only one player owns speech; unrelated preview surfaces cannot overlap it. */
export function claimSpeechFocus(stop: () => void) {
  cancel?.();
  const token = Symbol('speech');
  owner = token; cancel = stop;
  return {
    publish(value: SpeechActivity) { if (owner === token) publish(value); },
    release() {
      if (owner !== token) return;
      owner = undefined; cancel = undefined; publish('idle');
    },
  };
}
