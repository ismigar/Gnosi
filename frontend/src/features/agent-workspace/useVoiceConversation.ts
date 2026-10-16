import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceIdentity } from '../../shared/api/agent-workspace';
import { isElectron } from '../../shared/platform/electron';
import { useLocalVoiceCapture } from './useLocalVoiceCapture';

interface SpeechResult { readonly isFinal: boolean; readonly 0: { readonly transcript: string } }
interface RecognitionEvent { readonly results: ArrayLike<SpeechResult>; readonly resultIndex: number }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
  start(): void; abort(): void;
}
interface VoiceWindow {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
  speechSynthesis?: SpeechSynthesis;
}

/** Audio starts only from a user gesture and always stops with this scoped panel. */
export function useVoiceConversation(identity: WorkspaceIdentity, language: string, busy: boolean, reply: string,
  onPrompt: (text: string) => void) {
  const voiceWindow = window as unknown as VoiceWindow;
  // Electron exposes Chromium's recognition constructor without providing the
  // browser vendor's speech service. Desktop capture must use local transcription.
  const factory = isElectron ? undefined : voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition;
  const speech = voiceWindow.speechSynthesis;
  const [active, setActive] = useState(false);
  const [failed, setFailed] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const callback = useRef(onPrompt);
  const lastReply = useRef(reply);
  const fail = useCallback(() => { setFailed(true); setActive(false); setSpeaking(false); }, []);
  const local = useLocalVoiceCapture(identity, active && !factory, busy || speaking, language, onPrompt, fail);
  const supported = Boolean(factory || local.supported);
  useEffect(() => { callback.current = onPrompt; }, [onPrompt]);
  useEffect(() => {
    if (!active || busy || !speech) return;
    if (reply && reply !== lastReply.current) {
      lastReply.current = reply;
      const utterance = new SpeechSynthesisUtterance(reply.slice(0, 12000)); utterance.lang = language;
      utterance.onend = () => { setSpeaking(false); };
      utterance.onerror = fail;
      setSpeaking(true); speech.speak(utterance);
      return () => { utterance.onend = null; utterance.onerror = null; speech.cancel(); };
    }
  }, [active, busy, language, reply, speech, fail]);
  useEffect(() => {
    if (!active || busy || speaking || !factory) return;
    const listener = new factory(); recognition.current = listener;
    let endedByResult = false;
    listener.lang = language; listener.continuous = true; listener.interimResults = false;
    listener.onresult = event => {
      const values = Array.from(event.results).slice(event.resultIndex).filter(item => item.isFinal);
      const text = values.map(item => item[0].transcript).join(' ').trim();
      if (text) { endedByResult = true; listener.abort(); callback.current(text); }
    };
    listener.onerror = fail;
    listener.onend = () => { recognition.current = null; if (!endedByResult) setActive(false); };
    try { listener.start(); } catch {
      queueMicrotask(() => { if (recognition.current === listener) fail(); });
    }
    return () => { listener.onresult = null; listener.onerror = null; listener.onend = null; listener.abort(); recognition.current = null; };
  }, [active, busy, factory, language, speaking, fail]);
  useEffect(() => () => { recognition.current?.abort(); speech?.cancel(); }, [speech]);
  return { supported, active, failed, toggle: () => { setFailed(false); setSpeaking(false); setActive(value => !value); } };
}
