import { beforeEach, expect, it, vi } from 'vitest';
import { fetchSpeechSettings, previewSpeech, saveSpeechSettings, synthesizeWorkspaceSpeech } from './speech-output';
import { transportFetch } from './transports';
import { subscribeAppEvent } from '../platform/app-events';

vi.mock('./transports', () => ({ transportFetch: vi.fn() }));
beforeEach(() => { vi.mocked(transportFetch).mockReset(); });
it('reads a single speech configuration without changing it', async () => {
  const signal = new AbortController().signal;
  vi.mocked(transportFetch).mockResolvedValue(new Response(JSON.stringify({ settings: { provider: 'local' } })));
  const changed = vi.fn(); const unsubscribe = subscribeAppEvent('gnosi:config-changed', changed);
  try { await fetchSpeechSettings(signal); expect(transportFetch).toHaveBeenCalledWith('/api/speech/settings', { signal }); expect(changed).not.toHaveBeenCalled(); }
  finally { unsubscribe(); }
});
it('persists explicit global settings and announces a successful change', async () => {
  const settings = { provider: 'openai' as const, voice: 'marin', language: 'auto' as const, speed: 1 };
  vi.mocked(transportFetch).mockResolvedValue(new Response(JSON.stringify({ settings })));
  const changed = vi.fn(); const unsubscribe = subscribeAppEvent('gnosi:config-changed', changed);
  try {
    await saveSpeechSettings(settings);
    expect(transportFetch).toHaveBeenCalledWith('/api/speech/settings', expect.objectContaining({ method: 'PUT', body: JSON.stringify(settings) }));
    expect(changed).toHaveBeenCalledOnce();
  } finally { unsubscribe(); }
});
it('never sends provider overrides or credentials with conversational playback', async () => {
  vi.mocked(transportFetch).mockResolvedValue(new Response('audio', { headers: { 'content-type': 'audio/mpeg' } }));
  const signal = new AbortController().signal;
  await synthesizeWorkspaceSpeech({ agent_id: 'agent', session_id: 'session' }, 'Hello', 'ca-ES', signal);
  expect(transportFetch).toHaveBeenCalledWith('/api/workspace/voice/speak', expect.objectContaining({ signal,
    body: JSON.stringify({ agent_id: 'agent', session_id: 'session', text: 'Hello', language: 'ca' }) }));
});
it('requests only the fixed server sample for preview', async () => {
  vi.mocked(transportFetch).mockResolvedValue(new Response('audio', { headers: { 'content-type': 'audio/mpeg' } }));
  await previewSpeech('fr-FR', new AbortController().signal);
  expect(transportFetch).toHaveBeenCalledWith('/api/speech/preview', expect.objectContaining({ body: JSON.stringify({ language: 'fr' }) }));
});
it('rejects failed, non-audio and empty results without retry', async () => {
  vi.mocked(transportFetch).mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response('{}', { headers: { 'content-type': 'application/json' } }))
    .mockResolvedValueOnce(new Response('', { headers: { 'content-type': 'audio/mpeg' } }));
  for (const error of ['speech_http_503', 'speech_content_type', 'speech_audio_size']) {
    await expect(previewSpeech('en', new AbortController().signal)).rejects.toThrow(error);
  }
  expect(transportFetch).toHaveBeenCalledTimes(3);
});
