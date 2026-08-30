import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountPluginPanel, movePluginFrame, renderMountedPanel } from './frame-lifecycle';
import { iframeWindow, type PluginFrameEntry } from './host-model';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function fixture() {
  const iframe = document.createElement('iframe');
  const target = document.createElement('div');
  document.body.append(iframe, target);
  const entry: PluginFrameEntry = {
    iframe, generation: 0, registeredPanels: new Set(['appearance']),
    granted: ['ui:settings'], manifest: { id: 'fixture' },
  };
  return { entry, iframe, target };
}

describe('sandbox document and settings mount ownership', () => {
  it('waits for registration after an ordinary DOM move, then renders exactly once', () => {
    const { entry, iframe, target } = fixture();
    const cleanup = mountPluginPanel(entry, 'appearance', target, 360, () => true);
    const post = vi.spyOn(iframeWindow(iframe), 'postMessage');
    expect(entry.generation).toBe(1);
    expect(iframe.parentNode).toBe(target);
    expect(iframe.style.height).toBe('360px');
    renderMountedPanel(entry);
    expect(post).not.toHaveBeenCalled();
    entry.registeredPanels.add('different'); renderMountedPanel(entry);
    expect(post).not.toHaveBeenCalled();
    entry.registeredPanels.add('appearance'); renderMountedPanel(entry); renderMountedPanel(entry);
    expect(post).toHaveBeenCalledExactlyOnceWith({
      __gnosi_host: true, type: 'run', kind: 'settings', id: 'appearance', arg: null,
    }, '*');
    cleanup(); cleanup();
    expect(entry.generation).toBe(2);
    expect(entry.panelMount).toBeUndefined();
    expect(iframe.parentNode).toBe(document.body);
    expect(iframe.getAttribute('aria-hidden')).toBe('true');
  });

  it('preserves registry and generation with the native state-preserving operation', () => {
    const { entry, iframe, target } = fixture();
    const move = vi.fn<(node: Node, reference: Node | null) => void>();
    Object.defineProperty(target, 'moveBefore', { value: move });
    const post = vi.spyOn(iframeWindow(iframe), 'postMessage');
    mountPluginPanel(entry, 'appearance', target, 1500, () => true);
    expect(move).toHaveBeenCalledExactlyOnceWith(iframe, null);
    expect(entry.generation).toBe(0);
    expect(entry.registeredPanels.has('appearance')).toBe(true);
    expect(post).toHaveBeenCalledOnce();
    expect(iframe.style.height).toBe('1200px');
  });

  it('falls back when native movement rejects a disconnected container', () => {
    const { entry, iframe, target } = fixture();
    Object.defineProperty(target, 'moveBefore', { value: () => { throw new DOMException('Disconnected', 'HierarchyRequestError'); } });
    movePluginFrame(entry, target);
    expect(iframe.parentNode).toBe(target);
    expect(entry.generation).toBe(1);
    expect(entry.registeredPanels.size).toBe(0);
    movePluginFrame(entry, target);
    expect(entry.generation).toBe(1);
  });

  it('does not hide another mount or resurrect a retired frame during stale cleanup', () => {
    const { entry, iframe, target } = fixture();
    let current = true;
    const first = mountPluginPanel(entry, 'first', target, 100, () => current);
    expect(iframe.style.height).toBe('160px');
    const second = mountPluginPanel(entry, 'second', target, 420, () => current);
    first();
    expect(iframe.parentNode).toBe(target);
    expect(entry.panelMount?.panelId).toBe('second');
    current = false; iframe.remove(); second();
    expect(iframe.isConnected).toBe(false);
  });
});
