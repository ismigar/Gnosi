/**
 * host.ts — host for THIRD-PARTY plugins in the frontend (phases 1-2 and 4 of
 * plugin_system.md).
 *
 * Loads each UI plugin inside a sandboxed IFRAME (`sandbox="allow-scripts"`,
 * WITHOUT allow-same-origin → opaque origin: it cannot read the parent's DOM, nor its
 * cookies, nor make same-origin requests to the backend). All communication goes through
 * `postMessage`. A CSP inside the srcdoc blocks the network unless the plugin
 * has the `network` permission. This way a plugin cannot perform RCE or exfiltrate data:
 * it can only do what it declares in the manifest and what the user has approved.
 *
 * Extension points exposed to the plugin (global `gnosi` object inside the iframe):
 *   gnosi.registerCommand({id, title, icon?, run})   → command palette
 *   gnosi.registerView({id, title, icon?, render})    → own view
 *   gnosi.registerSidebarPanel({id, title, render})   → sidebar panel
 *   gnosi.registerSettingsPanel({id, title, render})  → sandboxed Settings panel
 *   gnosi.vault.readPage(id) / writePage(id, content) → data API (gated)
 *   gnosi.fetch(url, opts)                             → network (gated)
 *   gnosi.log/warn/error(...)                          → host console
 *
 * Module-level store with subscription (same pattern as usePlugins): the
 * command palette, the shell, and the config panel read the active contributions.
 */
import { getCachedPageEtag } from '../shared/api/page-etag';
import {
    createPluginHostPage,
    fetchForUiPlugin,
    fetchPluginAssetText,
    fetchPluginHostPage,
    fetchPluginSettings,
    patchPluginHostPage,
    updatePluginSettings,
    type PluginHostPagePatchInput,
} from '../shared/api/plugin-runtime';
import { fetchInstalledPlugins } from '../shared/api/plugins';
import type { InstalledPlugin, PluginManifest } from '../shared/api/plugins';
import { fetchVaultPagesByTable, fetchVaultTables } from '../shared/api/vaults';

type HostArguments = Record<string, unknown>;

export interface PluginCommandContribution {
    icon: unknown;
    id: unknown;
    pluginId: string;
    title: unknown;
}

export type PluginViewContribution = PluginCommandContribution;

export interface PluginSidebarContribution {
    id: unknown;
    pluginId: string;
    title: unknown;
}

export interface PluginSettingsContribution extends PluginSidebarContribution {
    height: unknown;
}

export interface PluginHostContributions {
    commands: PluginCommandContribution[];
    settingsPanels: PluginSettingsContribution[];
    sidebar: PluginSidebarContribution[];
    views: PluginViewContribution[];
}

interface PluginFrameEntry {
    granted: readonly string[];
    iframe: HTMLIFrameElement;
    listener?: (event: MessageEvent<unknown>) => void;
    manifest: PluginManifest;
}

interface HostMethod {
    perm: string;
    run: (args: HostArguments, pluginId: string) => Promise<unknown>;
}

type HostSubscriber = (snapshot: PluginHostContributions) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
    return Reflect.apply(String, undefined, [value || '']);
}

function iframeWindow(iframe: HTMLIFrameElement): Window {
    const target = iframe.contentWindow;
    if (!target) throw new Error('Plugin iframe has no content window');
    return target;
}

const _frames = new Map<string, PluginFrameEntry>();
let _commands: PluginCommandContribution[] = [];
let _views: PluginViewContribution[] = [];
let _sidebar: PluginSidebarContribution[] = [];
let _settingsPanels: PluginSettingsContribution[] = [];
let _loaded = false;
const _subs = new Set<HostSubscriber>();

function _snapshot(): PluginHostContributions {
    return {
        commands: [..._commands],
        views: [..._views],
        sidebar: [..._sidebar],
        settingsPanels: [..._settingsPanels],
    };
}

function _notify(): void {
    const snapshot = _snapshot();
    for (const fn of _subs) {
        try { fn(snapshot); } catch { /* noop */ }
    }
}

export function subscribeHost(fn: HostSubscriber): () => boolean {
    _subs.add(fn);
    fn({ commands: [..._commands], views: [..._views], sidebar: [..._sidebar], settingsPanels: [..._settingsPanels] });
    return () => _subs.delete(fn);
}

export function getContributions(): PluginHostContributions {
    return _snapshot();
}

// --- Runtime injected INSIDE the iframe --------------------------------------
// Runs in the sandbox's opaque origin. Exposes `gnosi` and acts as a bridge with the
// host via postMessage. Kept small and without dependencies.
function _runtimeSource(): string {
    return `
    (function () {
      var _cbs = {};            // command/view/panel callbacks per id
      var _pending = {};        // host-call id → {resolve, reject}
      var _seq = 0;
      function post(type, data) { parent.postMessage(Object.assign({ __gnosi: true, type: type }, data), '*'); }
      function call(method, args) {
        var id = 'c' + (++_seq);
        return new Promise(function (resolve, reject) {
          _pending[id] = { resolve: resolve, reject: reject };
          post('host-call', { id: id, method: method, args: args || {} });
        });
      }
      window.gnosi = {
        registerCommand: function (cmd) {
          if (!cmd || !cmd.id) return;
          _cbs['cmd:' + cmd.id] = cmd.run;
          post('register-command', { id: cmd.id, title: cmd.title || cmd.id, icon: cmd.icon || null });
        },
        registerView: function (view) {
          if (!view || !view.id) return;
          _cbs['view:' + view.id] = view.render;
          post('register-view', { id: view.id, title: view.title || view.id, icon: view.icon || null });
        },
        registerSidebarPanel: function (panel) {
          if (!panel || !panel.id) return;
          _cbs['panel:' + panel.id] = panel.render;
          post('register-panel', { id: panel.id, title: panel.title || panel.id });
        },
        registerSettingsPanel: function (panel) {
          if (!panel || !panel.id) return;
          _cbs['settings:' + panel.id] = panel.render;
          post('register-settings-panel', {
            id: panel.id,
            title: panel.title || panel.id,
            height: Math.max(160, Math.min(Number(panel.height) || 420, 1200))
          });
        },
        vault: {
          readPage: function (id) { return call('vault.readPage', { pageId: id }); },
          // writePage(id, "text nou")  o  writePage(id, {content, metadata})
          writePage: function (id, patch) {
            var p = (typeof patch === 'string') ? { content: patch } : (patch || {});
            return call('vault.writePage', Object.assign({ pageId: id }, p));
          },
          createPage: function (opts) { return call('vault.createPage', opts || {}); },
          queryDB: function (tableId, opts) { return call('vault.queryDB', { tableId: tableId, limit: (opts && opts.limit) || 200 }); },
          listTables: function () { return call('vault.listTables', {}); },
        },
        settings: {
          get: function () { return call('settings.get', {}); },
          set: function (settings) { return call('settings.set', { settings: settings }); },
        },
        fetch: function (url, opts) { return call('network.fetch', { url: url, opts: opts || {} }); },
        log: function () { post('log', { level: 'info', message: Array.prototype.join.call(arguments, ' ') }); },
        warn: function () { post('log', { level: 'warn', message: Array.prototype.join.call(arguments, ' ') }); },
        error: function () { post('log', { level: 'error', message: Array.prototype.join.call(arguments, ' ') }); }
      };
      window.addEventListener('message', function (e) {
        var m = e.data || {};
        if (!m.__gnosi_host) return;
        if (m.type === 'run') {
          var cb = _cbs[m.kind + ':' + m.id];
          if (typeof cb === 'function') { try { cb(m.arg); } catch (err) { window.gnosi.error(String(err)); } }
        } else if (m.type === 'host-result') {
          var p = _pending[m.id];
          if (!p) return; delete _pending[m.id];
          if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error || 'host error'));
        }
      });
      post('ready', {});
    })();`;
}

function _buildSrcdoc(pluginCode: unknown): string {
    // Direct network access is always blocked. A plugin with the network
    // capability uses the host bridge, which applies the backend SSRF guard.
    const csp = [
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        "connect-src 'none'",
        "img-src data:",
    ].join('; ');
    // Prevents a `</script>` inside the plugin's code from breaking the document.
    const safeRuntime = _runtimeSource().replace(/<\/(script)/gi, '<\\/$1');
    const safeCode = stringValue(pluginCode).replace(/<\/(script)/gi, '<\\/$1');
    return `<!doctype html><html><head><meta charset="utf-8">`
        + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
        + `</head><body>`
        + `<script>${safeRuntime}</script>`
        + `<script type="module">${safeCode}</script>`
        + `</body></html>`;
}

// --- Host handlers for the plugin's calls (gated by permission) --------
const _HOST_METHODS: Readonly<Record<string, HostMethod>> = {
    'vault.readPage': { perm: 'vault:read', run: async (args) => {
        const id = stringValue(args.pageId);
        const d = await fetchPluginHostPage(id);
        // Unified shape with the data sandbox: {pageId, title, content, metadata}.
        return { pageId: d.id, title: d.title, content: d.content, metadata: d.metadata };
    } },
    'vault.writePage': { perm: 'vault:write', run: async (args) => {
        const id = stringValue(args.pageId);
        // Partial update (PATCH preserves the frontmatter): content and/or metadata.
        const payload: PluginHostPagePatchInput = {};
        if (typeof args.content === 'string') payload.content = args.content;
        if (isRecord(args.metadata)) payload.metadata = args.metadata;
        await patchPluginHostPage(id, payload, { knownEtag: getCachedPageEtag(id) });
        return { pageId: id, written: typeof args.content === 'string' ? args.content.length : 0 };
    } },
    'vault.queryDB': { perm: 'vault:read', run: async (args) => {
        const id = stringValue(args.tableId);
        const limit = Math.max(1, Math.min(Number(args.limit) || 200, 1000));
        const response: unknown = await fetchVaultPagesByTable(id);
        const all = Array.isArray(response) ? response : [];
        // Templates (is_template) are not data: no other consumer of
        // by-table shows them as rows (DbViewEmbed, PageViewModal,
        // dashboard, sidebar). Without this filter a plugin would receive them
        // mixed in with the records — and `total`/`truncated` counted them.
        const records = all.filter((page) => (
            !isRecord(page)
            || !isRecord(page.metadata)
            || page.metadata.is_template !== true
        ));
        const rows = records.slice(0, limit).map((page) => {
            const record = isRecord(page) ? page : {};
            return {
                id: record.id,
                title: record.title,
                metadata: isRecord(record.metadata) ? record.metadata : {},
            };
        });
        return { tableId: id, rows, total: records.length, truncated: records.length > limit };
    } },
    'vault.listTables': { perm: 'vault:read', run: async () => {
        const response: unknown = await fetchVaultTables();
        const all = Array.isArray(response) ? response : [];
        return { tables: all.map((table) => {
            const record = isRecord(table) ? table : {};
            return {
                id: record.id,
                name: record.name || record.id,
                fields: Array.isArray(record.properties) ? record.properties.length : 0,
            };
        }) };
    } },
    'vault.createPage': { perm: 'vault:write', run: async (args) => {
        const response = await createPluginHostPage({
            title: typeof args.title === 'string' && args.title ? args.title : 'Sense títol',
            content: typeof args.content === 'string' ? args.content : '',
            metadata: {},
            ...(typeof args.parent_id === 'string' && args.parent_id
                ? { parent_id: args.parent_id }
                : {}),
        });
        return { pageId: response.id, title: response.title };
    } },
    'settings.get': { perm: 'settings', run: async (args, pluginId) => {
        const response = await fetchPluginSettings(pluginId);
        return { settings: response.settings };
    } },
    'settings.set': { perm: 'settings', run: async (args, pluginId) => {
        const response = await updatePluginSettings(
            pluginId,
            isRecord(args.settings) ? args.settings : {},
        );
        return { settings: response.settings };
    } },
    'network.fetch': { perm: 'network', run: async (args, pluginId) => {
        return fetchForUiPlugin(
            pluginId,
            typeof args.url === 'string' ? args.url : '',
            isRecord(args.opts) ? args.opts : {},
        );
    } },
};

function _onMessage(entry: PluginFrameEntry, ev: MessageEvent<unknown>): void {
    if (!isRecord(ev.data)) return;
    const m = ev.data;
    if (!m.__gnosi) return;
    // Ensures the message comes from THIS plugin's iframe.
    if (ev.source !== entry.iframe.contentWindow) return;
    const { manifest, granted, iframe } = entry;
    const pid = manifest.id;

    if (m.type === 'register-command') {
        if (!granted.includes('ui:command')) return;
        _commands = _commands.filter((c) => !(c.pluginId === pid && c.id === m.id));
        _commands.push({ pluginId: pid, id: m.id, title: m.title, icon: m.icon });
        _notify();
    } else if (m.type === 'register-view') {
        if (!granted.includes('ui:view')) return;
        _views = _views.filter((v) => !(v.pluginId === pid && v.id === m.id));
        _views.push({ pluginId: pid, id: m.id, title: m.title, icon: m.icon });
        _notify();
    } else if (m.type === 'register-panel') {
        if (!granted.includes('ui:sidebar')) return;
        _sidebar = _sidebar.filter((s) => !(s.pluginId === pid && s.id === m.id));
        _sidebar.push({ pluginId: pid, id: m.id, title: m.title });
        _notify();
    } else if (m.type === 'register-settings-panel') {
        if (!granted.includes('ui:settings')) return;
        _settingsPanels = _settingsPanels.filter((panel) => !(panel.pluginId === pid && panel.id === m.id));
        _settingsPanels.push({ pluginId: pid, id: m.id, title: m.title, height: m.height });
        _notify();
    } else if (m.type === 'log') {
        console[m.level === 'error' ? 'error' : m.level === 'warn' ? 'warn' : 'log'](`[plugin ${pid}]`, m.message);
    } else if (m.type === 'host-call') {
        if (typeof m.method !== 'string') return;
        const def = _HOST_METHODS[m.method];
        const reply = (ok: boolean, payload: unknown): void => {
            iframeWindow(iframe).postMessage(
                { __gnosi_host: true, type: 'host-result', id: m.id, ok, ...(ok ? { result: payload } : { error: payload }) },
                '*',
            );
        };
        if (!def) { reply(false, `mètode desconegut: ${m.method}`); return; }
        if (!granted.includes(def.perm)) { reply(false, `permís denegat: ${def.perm}`); return; }
        const args = isRecord(m.args) ? m.args : {};
        def.run(args, pid).then((result) => {
            reply(true, result);
        }).catch((error: unknown) => {
            reply(false, error instanceof Error ? error.message : stringValue(error));
        });
    }
}

function _mountPlugin(
    manifest: PluginManifest,
    granted: readonly string[],
    code: unknown,
): void {
    const pid = manifest.id;
    _unmountPlugin(pid);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('title', `plugin:${pid}`);
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
    iframe.srcdoc = _buildSrcdoc(code);
    const entry: PluginFrameEntry = { iframe, manifest, granted };
    const listener = (ev: MessageEvent<unknown>): void => {
        _onMessage(entry, ev);
    };
    entry.listener = listener;
    window.addEventListener('message', listener);
    document.body.appendChild(iframe);
    _frames.set(pid, entry);
}

function _unmountPlugin(pid: string): void {
    const entry = _frames.get(pid);
    if (!entry) return;
    if (entry.listener) window.removeEventListener('message', entry.listener);
    try { entry.iframe.remove(); } catch { /* noop */ }
    _frames.delete(pid);
    _commands = _commands.filter((c) => c.pluginId !== pid);
    _views = _views.filter((v) => v.pluginId !== pid);
    _sidebar = _sidebar.filter((s) => s.pluginId !== pid);
    _settingsPanels = _settingsPanels.filter((panel) => panel.pluginId !== pid);
    _notify();
}

/** Sends an execution call (command/view/panel) to the plugin's iframe. */
export function runCommand(pluginId: string, commandId: string, arg?: unknown): void {
    const entry = _frames.get(pluginId);
    if (!entry) return;
    iframeWindow(entry.iframe).postMessage(
        { __gnosi_host: true, type: 'run', kind: 'cmd', id: commandId, arg: arg || null }, '*');
}

/** Mounts a registered Settings panel's sandbox in a visible host container. */
export function mountSettingsPanel(
    pluginId: string,
    panelId: string,
    container: HTMLElement | null | undefined,
    height = 420,
): () => void {
    const entry = _frames.get(pluginId);
    if (!entry || !container) return () => {};
    const { iframe } = entry;
    iframe.removeAttribute('aria-hidden');
    const panelHeight = Math.max(160, Math.min(height || 420, 1200));
    iframe.style.cssText = `display:block;width:100%;height:${String(panelHeight)}px;border:0;background:transparent;`;
    container.appendChild(iframe);
    iframeWindow(iframe).postMessage(
        { __gnosi_host: true, type: 'run', kind: 'settings', id: panelId, arg: null }, '*');
    return () => {
        if (!_frames.has(pluginId)) return;
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
        document.body.appendChild(iframe);
    };
}

/** Loads (or reloads) all installed and active third-party plugins. */
export async function loadPlugins(): Promise<void> {
    let installed: readonly InstalledPlugin[];
    try {
        const response = await fetchInstalledPlugins();
        installed = response.plugins;
    } catch {
        return;
    }
    const seen = new Set<string>();
    for (const p of installed) {
        const manifest = p.manifest;
        if (!manifest || !p.enabled) continue;
        const granted = p.granted || [];
        const wantsUI = ['ui:command', 'ui:view', 'ui:sidebar', 'ui:settings'].some((x) => granted.includes(x));
        if (!manifest.main || !wantsUI) continue;
        seen.add(manifest.id);
        try {
            const code = await fetchPluginAssetText(manifest.id, manifest.main);
            _mountPlugin(manifest, granted, code);
        } catch (error: unknown) {
            console.warn(
                `[plugins] could not load ${manifest.id}:`,
                error instanceof Error ? error.message : error,
            );
        }
    }
    // Unmounts the ones that no longer apply (disabled or uninstalled).
    for (const pid of [..._frames.keys()]) {
        if (!seen.has(pid)) _unmountPlugin(pid);
    }
    _loaded = true;
}

export function isLoaded(): boolean { return _loaded; }
