import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpeechOutput } from './useSpeechOutput';
import { emitAppEvent } from '../platform/app-events';

const api = vi.hoisted(() => ({ speak: vi.fn(), preview: vi.fn() }));
vi.mock('../api/speech-output', () => ({ synthesizeWorkspaceSpeech: api.speak, previewSpeech: api.preview }));
class AudioStub {
  static instances: AudioStub[] = [];
  static deferStart = false;
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn(); removeAttribute = vi.fn(); play = vi.fn(() => { if (!AudioStub.deferStart) this.onplaying?.(); return Promise.resolve(); });
  constructor(readonly src: string) { AudioStub.instances.push(this); }
}
type Props = { active?: boolean; busy?: boolean; reply?: string; replyKey?: string; agent?: string };
let value: ReturnType<typeof useSpeechOutput>;
let root: Root; let host: HTMLDivElement;
function Probe({ active = false, busy = false, reply = '', replyKey = '', agent = 'agent' }: Props) {
  value = useSpeechOutput({ agent_id: agent, session_id: 'session' }, 'ca', active, busy, reply, replyKey);
  return null;
}
async function render(props: Props = {}) {
  await act(async () => { root.render(<Probe {...props} />); await Promise.resolve(); await Promise.resolve(); });
}
beforeEach(() => {
  vi.clearAllMocks(); AudioStub.instances = []; AudioStub.deferStart = false;
  api.speak.mockResolvedValue(new Blob(['mp3'], { type: 'audio/mpeg' }));
  api.preview.mockResolvedValue(new Blob(['sample'], { type: 'audio/mpeg' }));
  vi.stubGlobal('Audio', AudioStub); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); vi.unstubAllGlobals(); });

describe('shared synthesized speech playback', () => {
  it('keeps preparing until the media playing event and ignores a late start after stop', async () => {
    AudioStub.deferStart = true;
    await render({ active: true }); await render({ active: true, reply: 'New', replyKey: 'one' });
    expect(value.state).toBe('preparing');
    const started = AudioStub.instances[0]?.onplaying;
    await act(async () => { started?.(); }); expect(value.state).toBe('speaking');
    await act(async () => { value.stop(); started?.(); }); expect(value.state).toBe('idle');
  });
  it('never requests audio on mount or activation for an already visible reply', async () => {
    await render({ reply: 'Existing', replyKey: 'old' });
    await render({ active: true, reply: 'Existing', replyKey: 'old' });
    expect(api.speak).not.toHaveBeenCalled(); expect(api.preview).not.toHaveBeenCalled();
  });
  it('speaks completed turns using the same service, including identical text in distinct turns', async () => {
    await render({ active: true });
    await render({ active: true, busy: true, reply: '**Hello**', replyKey: 'one' });
    expect(api.speak).not.toHaveBeenCalled();
    await render({ active: true, reply: '**Hello**', replyKey: 'one' });
    expect(api.speak).toHaveBeenLastCalledWith({ agent_id: 'agent', session_id: 'session' }, 'Hello', 'ca', expect.any(AbortSignal));
    expect(value.state).toBe('speaking');
    await act(async () => { AudioStub.instances[0]?.onended?.(); await Promise.resolve(); });
    await render({ active: true, reply: '**Hello**', replyKey: 'two' });
    expect(api.speak).toHaveBeenCalledTimes(2);
  });
  it('aborts an outstanding request on stop and discards its late audio', async () => {
    let resolve: ((value: Blob) => void) | undefined;
    api.speak.mockImplementation(() => new Promise<Blob>(done => { resolve = done; }));
    await render({ active: true });
    await render({ active: true, reply: 'New', replyKey: 'one' });
    const signal = api.speak.mock.calls[0]?.[3] as AbortSignal;
    expect(value.state).toBe('preparing');
    await act(async () => { value.stop(); resolve?.(new Blob(['late'])); await Promise.resolve(); });
    expect(signal.aborted).toBe(true); expect(AudioStub.instances).toHaveLength(0); expect(value.state).toBe('idle');
  });
  it('releases audio immediately on scope, configuration and vault changes', async () => {
    await render({ active: true });
    await render({ active: true, reply: 'New', replyKey: 'one' });
    const audio = AudioStub.instances[0];
    await act(async () => { emitAppEvent('gnosi:config-changed'); });
    expect(audio?.pause).toHaveBeenCalled(); expect(audio?.onended).toBeNull(); expect(URL.revokeObjectURL).toHaveBeenCalled();
    await render({ active: true, reply: 'Next', replyKey: 'two' });
    const second = AudioStub.instances[1];
    await render({ active: true, reply: 'Next', replyKey: 'two', agent: 'other' });
    expect(second?.pause).toHaveBeenCalled();
    await act(async () => { void value.preview(); await Promise.resolve(); });
    const preview = AudioStub.instances.at(-1);
    await act(async () => { emitAppEvent('gnosi:vault-changed', { id: 'next', name: 'Next', slug: 'next' }); });
    expect(preview?.pause).toHaveBeenCalled();
  });
  it('uses the fixed server preview without posting arbitrary conversation text', async () => {
    await render(); await act(async () => { void value.preview(); await Promise.resolve(); });
    expect(api.preview).toHaveBeenCalledWith('ca', expect.any(AbortSignal)); expect(api.speak).not.toHaveBeenCalled();
  });
  it('reports output failures separately and does not retry or fall back to another engine', async () => {
    api.speak.mockRejectedValue(new Error('unconfigured'));
    await render({ active: true }); await render({ active: true, reply: 'New', replyKey: 'one' });
    expect(value.error).toBe(true); expect(value.state).toBe('idle'); expect(api.speak).toHaveBeenCalledOnce();
    await render({ active: true, reply: 'New', replyKey: 'one' });
    expect(api.speak).toHaveBeenCalledOnce();
  });
});
