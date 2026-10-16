import type { WorkspaceIdentity } from './agent-workspace';
import { transportFetch } from './transports';

export interface WorkspaceVoiceTranscript {
  readonly text: string;
  readonly language: string | null;
  readonly duration: number;
}

export async function transcribeWorkspaceVoice(identity: WorkspaceIdentity, audio: Blob,
  language: string, signal: AbortSignal): Promise<WorkspaceVoiceTranscript> {
  if (!audio.size || audio.size > 4 * 1024 * 1024) throw new Error('workspace_voice_size');
  const suffix = audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg' : 'webm';
  const body = new FormData();
  body.append('audio', audio, `voice.${suffix}`);
  body.append('agent_id', identity.agent_id);
  body.append('session_id', identity.session_id);
  body.append('language', language);
  const response = await transportFetch('/api/workspace/voice/transcribe', { method: 'POST', body, signal });
  if (!response.ok) throw new Error(`workspace_voice_http_${String(response.status)}`);
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('text' in result) || typeof result.text !== 'string'
    || !('duration' in result) || typeof result.duration !== 'number'
    || !('language' in result) || !(result.language === null || typeof result.language === 'string')) {
    throw new Error('workspace_voice_response');
  }
  return { text: result.text, duration: result.duration, language: result.language };
}
