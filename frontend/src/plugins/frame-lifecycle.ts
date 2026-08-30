import { postWindowMessage } from '../shared/platform/browser-events';
import { iframeWindow, type PluginFrameEntry } from './host-model';

/** Preserve a live document where supported; otherwise invalidate its pending RPC. */
export function movePluginFrame(entry: PluginFrameEntry, container: HTMLElement): void {
  const { iframe } = entry;
  if (iframe.parentNode === container) return;
  const moveBefore: unknown = Reflect.get(container, 'moveBefore');
  if (typeof moveBefore === 'function') {
    try {
      Reflect.apply(moveBefore, container, [iframe, null]);
      return;
    } catch (error: unknown) {
      if (!(error instanceof DOMException)) throw error;
      // A disconnected React container cannot use the state-preserving operation.
    }
  }
  entry.generation += 1;
  entry.registeredPanels.clear();
  if (entry.panelMount) entry.panelMount.rendered = false;
  container.appendChild(iframe);
}

export function renderMountedPanel(entry: PluginFrameEntry): void {
  const mount = entry.panelMount;
  if (!mount || mount.rendered || !entry.registeredPanels.has(mount.panelId)) return;
  mount.rendered = true;
  postWindowMessage(iframeWindow(entry.iframe), {
    __gnosi_host: true, type: 'run', kind: 'settings', id: mount.panelId, arg: null,
  }, '*');
}

export function mountPluginPanel(
  entry: PluginFrameEntry,
  panelId: string,
  container: HTMLElement,
  height: number,
  isCurrent: () => boolean,
): () => void {
  const { iframe } = entry;
  const mount = { panelId, rendered: false };
  entry.panelMount = mount;
  iframe.removeAttribute('aria-hidden');
  const panelHeight = Math.max(160, Math.min(height || 420, 1200));
  iframe.style.cssText = `display:block;width:100%;height:${String(panelHeight)}px;border:0;background:transparent;`;
  movePluginFrame(entry, container);
  renderMountedPanel(entry);
  return () => {
    if (!isCurrent() || entry.panelMount !== mount) return;
    entry.panelMount = undefined;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
    movePluginFrame(entry, document.body);
  };
}
