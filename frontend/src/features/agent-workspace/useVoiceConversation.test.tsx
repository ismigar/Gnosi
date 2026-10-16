import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceConversation } from './useVoiceConversation';

const local = vi.hoisted(() => ({ capture: vi.fn(), supported: false }));
const platform = vi.hoisted(() => ({ isElectron: false }));
vi.mock('../../shared/platform/electron', () => platform);
vi.mock('./useLocalVoiceCapture', () => ({ useLocalVoiceCapture: (...args: unknown[]) => { local.capture(...args); return { supported: local.supported }; } }));
class Recognition {
  static instances: Recognition[] = [];
  lang = ''; continuous = false; interimResults = false;
  onresult: ((event: { results: { isFinal: boolean; 0: { transcript: string } }[]; resultIndex: number }) => void) | null = null;
  onerror: (() => void) | null = null; onend: (() => void) | null = null;
  start = vi.fn(); abort = vi.fn();
  constructor() { Recognition.instances.push(this); }
}
const cancel = vi.fn(); const speak = vi.fn();
const identity = { agent_id: 'agent', session_id: 'session' };
const prompt = vi.fn();
let root: Root; let container: HTMLDivElement;
let value: ReturnType<typeof useVoiceConversation>;
let mounted = false;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function Probe({ busy = false, reply = '' }: { busy?: boolean; reply?: string }) {
  const next = useVoiceConversation(identity, 'ca', busy, reply, prompt);
  useEffect(() => { value = next; }, [next]);
  return <input aria-label="Typed composer" defaultValue="Unsubmitted draft" />;
}
async function render(props: { busy?: boolean; reply?: string } = {}) {
  await act(async () => { root.render(<Probe {...props} />); await Promise.resolve(); });
}
beforeEach(() => {
  vi.clearAllMocks(); Recognition.instances = []; local.supported = false; platform.isElectron = false;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); mounted = true;
  Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: Recognition });
  Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined });
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel, speak } });
});
afterEach(async () => {
  if (mounted) await act(async () => { root.unmount(); await Promise.resolve(); });
  container.remove();
  for (const key of ['SpeechRecognition', 'webkitSpeechRecognition', 'speechSynthesis']) Object.defineProperty(window, key, { configurable: true, value: undefined });
});
describe('voice conversation lifecycle', () => {
  it('uses local transcription in Electron even when browser recognition is exposed', async () => {
    platform.isElectron = true; local.supported = true;
    await render();
    expect(value.supported).toBe(true);
    expect(local.capture).toHaveBeenLastCalledWith(identity, false, false, 'ca', prompt, expect.any(Function));
    await act(async () => { value.toggle(); await Promise.resolve(); });
    expect(local.capture).toHaveBeenLastCalledWith(identity, true, false, 'ca', prompt, expect.any(Function));
    expect(Recognition.instances).toHaveLength(0);
    await render({ busy: true });
    expect(local.capture).toHaveBeenLastCalledWith(identity, true, true, 'ca', prompt, expect.any(Function));
    await act(async () => { value.toggle(); await Promise.resolve(); });
    expect(local.capture).toHaveBeenLastCalledWith(identity, false, true, 'ca', prompt, expect.any(Function));
    expect(container.querySelector('input')?.value).toBe('Unsubmitted draft');
  });
  it('does not advertise browser recognition as a desktop fallback when local capture is unavailable', async () => {
    platform.isElectron = true;
    await render();
    expect(value.supported).toBe(false);
    expect(Recognition.instances).toHaveLength(0);
  });
  it('requests no recognition on mount, and submits a final utterance without modifying the typed draft', async () => {
    await render(); expect(Recognition.instances).toHaveLength(0); expect(value.active).toBe(false);
    expect(local.capture).toHaveBeenLastCalledWith(identity, false, false, 'ca', prompt, expect.any(Function));
    await act(async () => { value.toggle(); await Promise.resolve(); });
    const listener = Recognition.instances[0];
    expect(listener?.start).toHaveBeenCalledOnce(); expect(listener?.lang).toBe('ca');
    await act(async () => { listener?.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: ' Add this next ' } }] }); await Promise.resolve(); });
    expect(prompt).toHaveBeenCalledWith('Add this next'); expect(listener?.abort).toHaveBeenCalled();
    expect(container.querySelector('input')?.value).toBe('Unsubmitted draft');
  });
  it('ignores interim results and pauses recognition while the agent works', async () => {
    await render(); await act(async () => { value.toggle(); await Promise.resolve(); });
    const listener = Recognition.instances[0];
    await act(async () => { listener?.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'unfinished' } }] }); await Promise.resolve(); });
    expect(prompt).not.toHaveBeenCalled(); await render({ busy: true });
    expect(listener?.abort).toHaveBeenCalled(); expect(listener?.onresult).toBeNull();
    await render({ busy: false }); expect(Recognition.instances).toHaveLength(2);
  });
  it('stops and removes recognition callbacks on explicit stop and unmount', async () => {
    await render(); await act(async () => { value.toggle(); await Promise.resolve(); });
    const listener = Recognition.instances[0];
    await act(async () => { value.toggle(); await Promise.resolve(); }); expect(value.active).toBe(false);
    expect(listener?.abort).toHaveBeenCalled(); expect(listener?.onresult).toBeNull();
    await act(async () => { value.toggle(); await Promise.resolve(); }); const next = Recognition.instances[1];
    await act(async () => { root.unmount(); await Promise.resolve(); }); mounted = false;
    expect(next?.abort).toHaveBeenCalled(); expect(next?.onerror).toBeNull(); expect(cancel).toHaveBeenCalled();
  });
  it('reports recognition failures and stops the listener', async () => {
    await render(); await act(async () => { value.toggle(); await Promise.resolve(); });
    const listener = Recognition.instances[0];
    await act(async () => { listener?.onerror?.(); await Promise.resolve(); });
    expect(value.failed).toBe(true); expect(value.active).toBe(false);
    expect(listener?.abort).toHaveBeenCalled(); expect(listener?.onresult).toBeNull();
  });
  it('speaks only a new reply and cancels speech on stop', async () => {
    class Utterance {
      lang = ''; onend: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    try {
      await render({ reply: 'Already visible reply' });
      await act(async () => { value.toggle(); await Promise.resolve(); }); expect(speak).not.toHaveBeenCalled();
      await render({ reply: 'New reply' });
      expect(speak).toHaveBeenCalledOnce();
      expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'New reply', lang: 'ca' }));
      expect(Recognition.instances[0]?.abort).toHaveBeenCalled();
      await act(async () => { value.toggle(); await Promise.resolve(); }); expect(cancel).toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('uses the local microphone fallback only after activation and passes suspension and stop', async () => {
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined }); local.supported = true;
    await render(); expect(value.supported).toBe(true);
    expect(local.capture).toHaveBeenLastCalledWith(identity, false, false, 'ca', prompt, expect.any(Function));
    await act(async () => { value.toggle(); await Promise.resolve(); });
    expect(local.capture).toHaveBeenLastCalledWith(identity, true, false, 'ca', prompt, expect.any(Function));
    await render({ busy: true });
    expect(local.capture).toHaveBeenLastCalledWith(identity, true, true, 'ca', prompt, expect.any(Function));
    await act(async () => { value.toggle(); await Promise.resolve(); });
    expect(local.capture).toHaveBeenLastCalledWith(identity, false, true, 'ca', prompt, expect.any(Function));
  });
  it('cleans up safely when neither recognition nor local capture is available', async () => {
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined });
    await render(); expect(value.supported).toBe(false); expect(Recognition.instances).toHaveLength(0);
    await act(async () => { root.unmount(); await Promise.resolve(); }); mounted = false; expect(prompt).not.toHaveBeenCalled();
  });
});
