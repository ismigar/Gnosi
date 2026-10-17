import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WorkspaceIdentity } from '../api/agent-workspace';
import { previewSpeech, synthesizeWorkspaceSpeech } from '../api/speech-output';
import { speechChunks, speechText } from './speechText';
import { subscribeAppEvent } from '../platform/app-events';
import { claimSpeechFocus, currentSpeechActivity, subscribeSpeechActivity } from './speechFocus';

type SpeechState = 'idle' | 'preparing' | 'speaking';
type SpeechSnapshot = { state: SpeechState; error: boolean };

/** Media callbacks and scope cleanup update the same observable snapshot. */
function createOutputStatus() {
  let snapshot: SpeechSnapshot = { state: 'idle', error: false };
  const listeners = new Set<() => void>();
  return {
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    update: (patch: Partial<SpeechSnapshot>) => {
      const next = { ...snapshot, ...patch };
      if (next.state === snapshot.state && next.error === snapshot.error) return;
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

/** Playback only: configuration and synthesis are shared by every app consumer. */
export function useSpeechOutput(identity: WorkspaceIdentity | undefined, language: string, active = false,
  busy = false, reply = '', replyKey = '') {
  const [status] = useState(createOutputStatus);
  const { state, error } = useSyncExternalStore(status.subscribe, status.snapshot, status.snapshot);
  const generation = useRef(0);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const request = useRef<AbortController | undefined>(undefined);
  const focus = useRef<ReturnType<typeof claimSpeechFocus> | undefined>(undefined);
  const activity = useSyncExternalStore(subscribeSpeechActivity, currentSpeechActivity, () => 'idle');
  const lastReply = useRef(replyKey);
  const agentId = identity?.agent_id;
  const sessionId = identity?.session_id;

  const stop = useCallback(() => {
    generation.current += 1;
    request.current?.abort(); request.current = undefined;
    cleanup.current?.(); cleanup.current = undefined;
    focus.current?.release(); focus.current = undefined;
    status.update({ state: 'idle' });
  }, [status]);
  const progress = useCallback((next: SpeechState) => { status.update({ state: next }); focus.current?.publish(next); }, [status]);

  const run = useCallback(async (markdown?: string) => {
    stop(); status.update({ error: false });
    const text = markdown === undefined ? undefined : speechText(markdown);
    if (text === '') return;
    const token = generation.current;
    const abort = new AbortController(); request.current = abort;
    focus.current = claimSpeechFocus(stop);
    progress('preparing');
    try {
      const chunks = text === undefined ? [undefined] : speechChunks(text);
      for (const chunk of chunks) {
        if (generation.current !== token) return;
        if (chunk !== undefined && (!agentId || !sessionId)) throw new Error('speech_scope');
        const blob = chunk === undefined ? await previewSpeech(language, abort.signal)
          : await synthesizeWorkspaceSpeech({ agent_id: agentId ?? '', session_id: sessionId ?? '' }, chunk, language, abort.signal);
        if (generation.current !== token) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        let released = false;
        const completed = await new Promise<boolean>((resolve, reject) => {
          const release = () => {
            if (released) return;
            released = true; audio.onended = null; audio.onerror = null; audio.onplaying = null;
            audio.pause(); audio.removeAttribute('src'); URL.revokeObjectURL(url);
          };
          const clearOwned = () => { if (generation.current === token) cleanup.current = undefined; };
          cleanup.current = () => { release(); resolve(false); };
          audio.onended = () => { release(); clearOwned(); resolve(true); };
          audio.onerror = () => { release(); clearOwned(); reject(new Error('speech_playback')); };
          audio.onplaying = () => { if (generation.current === token && !released) progress('speaking'); };
          void audio.play().catch(() => { release(); clearOwned(); reject(new Error('speech_playback')); });
        });
        if (!completed) return;
        if (generation.current === token) progress('preparing');
      }
      if (generation.current === token) { request.current = undefined; focus.current.release(); focus.current = undefined; status.update({ state: 'idle' }); }
    } catch {
      if (generation.current === token && !abort.signal.aborted) { stop(); status.update({ error: true }); }
    }
  }, [stop, progress, agentId, sessionId, language, status]);

  useEffect(() => { stop(); }, [stop, agentId, sessionId, language]);
  useEffect(() => {
    const vault = subscribeAppEvent('gnosi:vault-changed', stop);
    const configuration = subscribeAppEvent('gnosi:config-changed', stop);
    return () => { vault(); configuration(); };
  }, [stop]);
  useEffect(() => {
    if (!active) { lastReply.current = replyKey; stop(); return; }
    if (busy) { stop(); return; }
    if (!reply || replyKey === lastReply.current) return;
    lastReply.current = replyKey;
    void run(reply);
  }, [active, busy, reply, replyKey, run, stop]);
  useEffect(() => () => { generation.current += 1; request.current?.abort(); cleanup.current?.(); focus.current?.release(); }, []);
  return { state, activity, error, play: run, preview: () => run(), stop };
}
