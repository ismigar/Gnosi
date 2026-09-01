/**
 * host.ts — host for THIRD-PARTY plugins in the frontend (phases 1-2 and 4 of
 * plugin_system.md).
 *
 * Loads each UI plugin inside a sandboxed IFRAME (`sandbox="allow-scripts"`,
 * WITHOUT allow-same-origin → opaque origin: it cannot read the parent's DOM, nor its
 * cookies, nor make same-origin requests to the backend). All communication goes through
 * `postMessage`. A CSP blocks direct networking, including for plugins granted
 * `network`; their requests go through permission-gated host RPC.
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
import { fetchPluginAssetText } from '../api/plugin-runtime';
import { fetchInstalledPlugins, type InstalledPlugin, type PluginManifest } from '../api/plugins';
import { postWindowMessage, subscribeWindowEvent } from '../platform/browser-events';
import { HOST_METHODS } from './host-methods';
import { mountPluginPanel, renderMountedPanel } from './frame-lifecycle';
import {
  iframeWindow, isRecord, stringValue, type HostSubscriber,
  type PluginCommandContribution, type PluginFrameEntry, type PluginHostContributions,
  type PluginSettingsContribution, type PluginSidebarContribution, type PluginViewContribution,
} from './host-model';
import { buildPluginSrcdoc } from './sandbox/document';

export type {
  PluginCommandContribution, PluginHostContributions, PluginSettingsContribution,
  PluginSidebarContribution, PluginViewContribution,
} from './host-model';

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
        entry.registeredPanels.add(m.id);
        renderMountedPanel(entry);
        _settingsPanels = _settingsPanels.filter((panel) => !(panel.pluginId === pid && panel.id === m.id));
        _settingsPanels.push({ pluginId: pid, id: m.id, title: m.title, height: m.height });
        _notify();
    } else if (m.type === 'log') {
        console[m.level === 'error' ? 'error' : m.level === 'warn' ? 'warn' : 'log'](`[plugin ${pid}]`, m.message);
    } else if (m.type === 'host-call') {
        if (typeof m.method !== 'string') return;
        const def = HOST_METHODS[m.method];
        const generation = entry.generation;
        const reply = (ok: boolean, payload: unknown): void => {
            if (_frames.get(pid) !== entry || entry.generation !== generation) return;
            postWindowMessage(iframeWindow(iframe),
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
    iframe.srcdoc = buildPluginSrcdoc(code);
    const entry: PluginFrameEntry = { iframe, manifest, granted, generation: 0, registeredPanels: new Set() };
    const listener = (ev: MessageEvent<unknown>): void => {
        _onMessage(entry, ev);
    };
    entry.unsubscribe = subscribeWindowEvent('message', listener);
    document.body.appendChild(iframe);
    _frames.set(pid, entry);
}

function _unmountPlugin(pid: string): void {
    const entry = _frames.get(pid);
    if (!entry) return;
    entry.unsubscribe?.();
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
    postWindowMessage(iframeWindow(entry.iframe),
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
    return mountPluginPanel(entry, panelId, container, height, () => _frames.get(pluginId) === entry);
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
