import type { WorkspaceIdentity } from './agent-workspace';
import { transportFetch } from './transports';
import { emitAppEvent } from '../platform/app-events';

export interface SpeechSettings {
  provider: 'local' | 'openai'; voice: string; language: 'auto' | 'ca' | 'en' | 'es' | 'fr'; speed: number;
}
export interface SpeechConfiguration {
  settings: SpeechSettings; revision: string; local_available: boolean;
  local_voices: { id: string; language: string }[]; openai_configured: boolean;
}

function speechLanguage(language: string): string {
  const base = language.toLowerCase().split(/[-_]/)[0];
  return base && ['ca', 'en', 'es', 'fr'].includes(base) ? base : 'en';
}

export async function fetchSpeechSettings(signal?: AbortSignal): Promise<SpeechConfiguration> {
  const response = await transportFetch('/api/speech/settings', { signal });
  if (!response.ok) throw new Error('speech_settings');
  return response.json() as Promise<SpeechConfiguration>;
}

export async function saveSpeechSettings(settings: SpeechSettings, signal?: AbortSignal): Promise<SpeechConfiguration> {
  const response = await transportFetch('/api/speech/settings', { method: 'PUT', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
  if (!response.ok) throw new Error('speech_settings');
  const result = await response.json() as SpeechConfiguration;
  emitAppEvent('gnosi:config-changed');
  return result;
}

async function speechAudio(response: Response): Promise<Blob> {
  if (!response.ok) throw new Error(`speech_http_${String(response.status)}`);
  if (!(response.headers.get('content-type') || '').startsWith('audio/mpeg')) throw new Error('speech_content_type');
  const blob = await response.blob();
  if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error('speech_audio_size');
  return blob;
}

export async function previewSpeech(language: string, signal: AbortSignal): Promise<Blob> {
  return speechAudio(await transportFetch('/api/speech/preview', { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: speechLanguage(language) }) }));
}

/** Every consumer uses the same server-owned speech configuration. */
export async function synthesizeWorkspaceSpeech(identity: WorkspaceIdentity, text: string,
  language: string, signal: AbortSignal): Promise<Blob> {
  const response = await transportFetch('/api/workspace/voice/speak', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...identity, text, language: speechLanguage(language) }),
  });
  return speechAudio(response);
}
