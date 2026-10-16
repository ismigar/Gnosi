import { useEffect, useRef } from 'react';
import type { WorkspaceIdentity } from '../../shared/api/agent-workspace';
import { transcribeWorkspaceVoice } from '../../shared/api/agent-workspace-voice';

const MAX_BYTES = 4 * 1024 * 1024;
const FORMATS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/** The caller's active state must come from an explicit user start action. */
export function useLocalVoiceCapture(identity: WorkspaceIdentity, active: boolean, suspended: boolean,
  language: string, onPrompt: (text: string) => void, onError: () => void): { supported: boolean } {
  const prompt = useRef(onPrompt);
  const error = useRef(onError);
  useEffect(() => { prompt.current = onPrompt; error.current = onError; }, [onPrompt, onError]);
  const supported = typeof MediaRecorder !== 'undefined' && 'mediaDevices' in navigator
    && typeof navigator.mediaDevices.getUserMedia === 'function';
  const agentId = identity.agent_id;
  const sessionId = identity.session_id;
  useEffect(() => {
    if (!supported || !active || suspended) return;
    const captureIdentity = { agent_id: agentId, session_id: sessionId };
    let disposed = false;
    let stream: MediaStream | undefined;
    let recorder: MediaRecorder | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const failed = () => {
      if (disposed) return;
      disposed = true;
      if (timer) clearTimeout(timer);
      request?.abort();
      if (recorder) {
        recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
        if (recorder.state !== 'inactive') recorder.stop();
      }
      stream?.getTracks().forEach(track => { track.stop(); });
      error.current();
    };
    const record = () => {
      if (disposed || !stream) return;
      const mimeType = FORMATS.find(format => MediaRecorder.isTypeSupported(format));
      if (!mimeType) { failed(); return; }
      const parts: Blob[] = [];
      let bytes = 0;
      recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = event => {
        bytes += event.data.size;
        if (bytes <= MAX_BYTES) parts.push(event.data);
        else { failed(); if (recorder?.state === 'recording') recorder.stop(); }
      };
      recorder.onerror = failed;
      recorder.onstop = () => {
        if (timer) clearTimeout(timer);
        if (disposed || bytes > MAX_BYTES) return;
        const chunk = new Blob(parts, { type: mimeType });
        if (!chunk.size) { record(); return; }
        request = new AbortController();
        // Wait for transcription before restarting, avoiding unbounded concurrent inference.
        void transcribeWorkspaceVoice(captureIdentity, chunk, language, request.signal).then(result => {
          if (disposed) return;
          const text = result.text.trim();
          if (text) { stream?.getTracks().forEach(track => { track.stop(); }); prompt.current(text); }
          else record();
        }).catch(() => { if (!disposed && !request?.signal.aborted) failed(); });
      };
      recorder.start();
      timer = setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); }, 4000);
    };
    void navigator.mediaDevices.getUserMedia({ audio: true }).then(value => {
      if (disposed) { value.getTracks().forEach(track => { track.stop(); }); return; }
      stream = value;
      try { record(); } catch { failed(); }
    }).catch(failed);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      request?.abort();
      if (recorder) {
        recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
        if (recorder.state !== 'inactive') recorder.stop();
      }
      stream?.getTracks().forEach(track => { track.stop(); });
    };
  }, [agentId, sessionId, active, suspended, supported, language]);
  return { supported };
}
