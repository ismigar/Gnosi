import { beforeEach, expect, it, vi } from 'vitest';
import { transcribeWorkspaceVoice } from './agent-workspace-voice';
import { transportFetch } from './transports';

vi.mock('./transports', () => ({ transportFetch: vi.fn() }));
beforeEach(() => { vi.mocked(transportFetch).mockReset(); });

it('sends bounded multipart audio with the current scope and abort signal', async () => {
  vi.mocked(transportFetch).mockResolvedValue(new Response(JSON.stringify({ text: 'Hello', language: 'en', duration: 4 })));
  const controller = new AbortController();
  const result = await transcribeWorkspaceVoice({ agent_id: 'agent', session_id: 'session' }, new Blob(['audio'], { type: 'audio/webm' }), 'en', controller.signal);
  expect(result.text).toBe('Hello');
  const call = vi.mocked(transportFetch).mock.calls[0];
  expect(call?.[0]).toBe('/api/workspace/voice/transcribe');
  expect(call?.[1]?.signal).toBe(controller.signal);
  const body = call?.[1]?.body;
  expect(body).toBeInstanceOf(FormData);
  if (!(body instanceof FormData)) throw new Error('Missing form');
  expect(body.get('agent_id')).toBe('agent');
  expect(body.get('session_id')).toBe('session');
  expect(body.get('audio')).toBeInstanceOf(Blob);
});

it('rejects oversized chunks before sending them', async () => {
  await expect(transcribeWorkspaceVoice({ agent_id: 'agent', session_id: 'session' }, new Blob([new Uint8Array(4 * 1024 * 1024 + 1)]), 'en', new AbortController().signal)).rejects.toThrow('workspace_voice_size');
  expect(transportFetch).not.toHaveBeenCalled();
});
