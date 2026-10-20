import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocalVoiceCapture } from './useLocalVoiceCapture';
import { transcribeWorkspaceVoice } from '../../shared/api/agent-workspace-voice';

const mounted: { root: Root; container: HTMLElement }[] = [];
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function renderHook<P = undefined>(callback: (props: P) => unknown, options?: { initialProps: P }) {
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container); mounted.push({ root, container });
  function Probe({ value }: { value: P }) { callback(value); return null; }
  const rerender = (value: P) => { act(() => { root.render(<Probe value={value} />); }); };
  rerender(options?.initialProps as P);
  return { rerender, unmount: () => { act(() => { root.unmount(); }); } };
}
function cleanup() { for (const { root, container } of mounted.splice(0)) { act(() => { root.unmount(); }); container.remove(); } }

vi.mock('../../shared/api/agent-workspace-voice', () => ({ transcribeWorkspaceVoice: vi.fn() }));

class Recorder {
  static instances: Recorder[] = [];
  static isTypeSupported = () => true;
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { Recorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['complete chunk'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

const identity = { agent_id: 'agent', session_id: 'session' };
const stop = vi.fn();
const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
const getUserMedia = vi.fn<() => Promise<MediaStream>>();

beforeEach(() => {
  vi.useFakeTimers(); Recorder.instances = []; stop.mockReset();
  getUserMedia.mockReset().mockResolvedValue(stream);
  vi.stubGlobal('MediaRecorder', Recorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.mocked(transcribeWorkspaceVoice).mockReset().mockResolvedValue({ text: 'A prompt', language: 'en', duration: 4 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function settle() { await act(async () => { await Promise.resolve(); }); }

describe('local voice capture', () => {
  it('starts only when explicitly active and submits a complete recorder chunk', async () => {
    const prompt = vi.fn(); const error = vi.fn();
    const { rerender, unmount } = renderHook(({ active }) => useLocalVoiceCapture(identity, active, false, 'en', prompt, error), { initialProps: { active: false } });
    expect(getUserMedia).not.toHaveBeenCalled();
    rerender({ active: true }); await settle();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    await act(async () => { vi.advanceTimersByTime(4000); await Promise.resolve(); });
    expect(transcribeWorkspaceVoice).toHaveBeenCalledOnce();
    expect(prompt).toHaveBeenCalledWith('A prompt');
    expect(error).not.toHaveBeenCalled();
    unmount(); expect(stop).toHaveBeenCalled();
  });

  it('aborts in-flight transcription on scope changes and discards old results', async () => {
    let resolve: ((value: { text: string; language: string; duration: number }) => void) | undefined;
    vi.mocked(transcribeWorkspaceVoice).mockImplementation(() => new Promise(done => { resolve = done; }));
    const prompt = vi.fn();
    const { rerender } = renderHook(({ session }) => useLocalVoiceCapture({ ...identity, session_id: session }, true, false, 'en', prompt, vi.fn()), { initialProps: { session: 'first' } });
    await settle();
    act(() => { vi.advanceTimersByTime(4000); });
    const signal = vi.mocked(transcribeWorkspaceVoice).mock.calls[0]?.[3];
    rerender({ session: 'second' }); await settle();
    expect(signal?.aborted).toBe(true); expect(stop).toHaveBeenCalled();
    await act(async () => { resolve?.({ text: 'Stale', language: 'en', duration: 4 }); await Promise.resolve(); });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('stops microphone tracks on suspension', async () => {
    const { rerender } = renderHook(({ suspended }) => useLocalVoiceCapture(identity, true, suspended, 'en', vi.fn(), vi.fn()), { initialProps: { suspended: false } });
    await settle(); rerender({ suspended: true });
    expect(stop).toHaveBeenCalled();
    expect(Recorder.instances[0]?.state).toBe('inactive');
    act(() => { vi.advanceTimersByTime(8000); });
    expect(transcribeWorkspaceVoice).not.toHaveBeenCalled();
  });

  it('restarts with a fresh recorder after an empty transcript', async () => {
    vi.mocked(transcribeWorkspaceVoice).mockResolvedValue({ text: '', language: 'en', duration: 4 });
    renderHook(() => useLocalVoiceCapture(identity, true, false, 'en', vi.fn(), vi.fn()));
    await settle(); await act(async () => { vi.advanceTimersByTime(4000); await Promise.resolve(); });
    expect(Recorder.instances).toHaveLength(2);
    expect(Recorder.instances[1]?.state).toBe('recording');
  });

  it('keeps capturing later utterances when the prompt stays queued without a busy transition', async () => {
    const prompt = vi.fn(); const error = vi.fn();
    vi.mocked(transcribeWorkspaceVoice)
      .mockResolvedValueOnce({ text: 'First queued instruction', language: 'en', duration: 4 })
      .mockResolvedValueOnce({ text: 'Second queued instruction', language: 'en', duration: 4 });
    const { unmount } = renderHook(() => useLocalVoiceCapture(identity, true, false, 'en', prompt, error));
    await settle();
    await act(async () => { vi.advanceTimersByTime(4000); await Promise.resolve(); });
    expect(prompt).toHaveBeenNthCalledWith(1, 'First queued instruction');
    expect(stop).not.toHaveBeenCalled();
    expect(Recorder.instances[1]?.state).toBe('recording');
    await act(async () => { vi.advanceTimersByTime(4000); await Promise.resolve(); });
    expect(prompt).toHaveBeenNthCalledWith(2, 'Second queued instruction');
    expect(Recorder.instances[2]?.state).toBe('recording');
    expect(error).not.toHaveBeenCalled();
    unmount();
    expect(stop).toHaveBeenCalled();
    expect(Recorder.instances[2]?.state).toBe('inactive');
  });
});

it('closes tracks from a permission response received after unmount', async () => {
  let resolve: ((value: MediaStream) => void) | undefined;
  getUserMedia.mockImplementation(() => new Promise(done => { resolve = done; }));
  const prompt = vi.fn();
  const { unmount } = renderHook(() => useLocalVoiceCapture(identity, true, false, 'en', prompt, vi.fn()));
  unmount();
  await act(async () => { resolve?.(stream); await Promise.resolve(); });
  expect(stop).toHaveBeenCalled();
  expect(Recorder.instances).toHaveLength(0);
  expect(prompt).not.toHaveBeenCalled();
});
