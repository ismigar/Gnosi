import type { SandboxApi, SandboxScope } from './contracts';

/**
 * Standalone iframe event adapter. This entire function is serialized into srcdoc.
 * Keep all executable dependencies inside it; type-only imports are erased.
 */
export function installSandboxRuntime(scope: SandboxScope): void {
  const callbacks = new Map<string, unknown>();
  const pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  let sequence = 0;

  // API v2 accepts coercible identifiers and errors; retain native String semantics.
  function compatibilityText(value: unknown): string {
    return Reflect.apply(String, undefined, [value]);
  }

  function post(type: string, data: Record<string, unknown>): void {
    scope.parent.postMessage(Object.assign({ __gnosi: true, type }, data), '*');
  }

  function call(method: string, args: Record<string, unknown>): Promise<unknown> {
    const id = `c${String(++sequence)}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post('host-call', { id, method, args });
    });
  }

  const api: SandboxApi = {
    registerCommand(command) {
      if (!command?.id) return;
      callbacks.set(`cmd:${compatibilityText(command.id)}`, command.run);
      post('register-command', { id: command.id, title: command.title || command.id, icon: command.icon || null });
    },
    registerView(view) {
      if (!view?.id) return;
      callbacks.set(`view:${compatibilityText(view.id)}`, view.render);
      post('register-view', { id: view.id, title: view.title || view.id, icon: view.icon || null });
    },
    registerSidebarPanel(panel) {
      if (!panel?.id) return;
      callbacks.set(`panel:${compatibilityText(panel.id)}`, panel.render);
      post('register-panel', { id: panel.id, title: panel.title || panel.id });
    },
    registerSettingsPanel(panel) {
      if (!panel?.id) return;
      callbacks.set(`settings:${compatibilityText(panel.id)}`, panel.render);
      post('register-settings-panel', {
        id: panel.id,
        title: panel.title || panel.id,
        height: Math.max(160, Math.min(Number(panel.height) || 420, 1200)),
      });
    },
    vault: {
      readPage: (id) => call('vault.readPage', { pageId: id }),
      writePage(id, patch) {
        const data = typeof patch === 'string' ? { content: patch } : (patch || {});
        return call('vault.writePage', Object.assign({ pageId: id }, data));
      },
      createPage: (options) => call('vault.createPage', options || {}),
      queryDB: (tableId, options) => call('vault.queryDB', { tableId, limit: options?.limit || 200 }),
      listTables: () => call('vault.listTables', {}),
    },
    settings: {
      get: () => call('settings.get', {}),
      set: (settings) => call('settings.set', { settings }),
    },
    fetch: (url, options) => call('network.fetch', { url, opts: options || {} }),
    log(...values) { post('log', { level: 'info', message: values.join(' ') }); },
    warn(...values) { post('log', { level: 'warn', message: values.join(' ') }); },
    error(...values) { post('log', { level: 'error', message: values.join(' ') }); },
  };
  scope.gnosi = api;

  scope.addEventListener('message', (event) => {
    // An opaque origin alone does not identify the sender; only our parent may reply.
    if (event.source !== scope.parent) return;
    const data = event.data;
    if (typeof data !== 'object' || data === null) return;
    const message = data as Record<string, unknown>;
    if (!message.__gnosi_host) return;
    if (message.type === 'run') {
      const callback = callbacks.get(`${compatibilityText(message.kind)}:${compatibilityText(message.id)}`);
      if (typeof callback === 'function') {
        try { Reflect.apply(callback, undefined, [message.arg]); }
        catch (error: unknown) { scope.gnosi?.error(String(error)); }
      }
    } else if (message.type === 'host-result') {
      const id = compatibilityText(message.id);
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      if (message.ok) request.resolve(message.result);
      else request.reject(new Error(compatibilityText(message.error || 'host error')));
    }
  });
  post('ready', {});
}
