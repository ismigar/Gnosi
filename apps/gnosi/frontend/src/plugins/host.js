/**
 * host.js — host for THIRD-PARTY plugins in the frontend (phases 1-2 and 4 of
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
 *   gnosi.vault.readPage(id) / writePage(id, content) → data API (gated)
 *   gnosi.fetch(url, opts)                             → network (gated)
 *   gnosi.log/warn/error(...)                          → host console
 *
 * Module-level store with subscription (same pattern as usePlugins): the
 * command palette, the shell, and the config panel read the active contributions.
 */
import axios from 'axios';

const API = '/api/vault/plugins';

const _frames = new Map();        // pluginId → { iframe, manifest, granted }
let _commands = [];               // { pluginId, id, title, icon }
let _views = [];                  // { pluginId, id, title, icon }
let _sidebar = [];                // { pluginId, id, title }
let _loaded = false;
const _subs = new Set();

function _notify() {
    const snapshot = {
        commands: [..._commands],
        views: [..._views],
        sidebar: [..._sidebar],
    };
    for (const fn of _subs) {
        try { fn(snapshot); } catch { /* noop */ }
    }
}

export function subscribeHost(fn) {
    _subs.add(fn);
    fn({ commands: [..._commands], views: [..._views], sidebar: [..._sidebar] });
    return () => _subs.delete(fn);
}

export function getContributions() {
    return { commands: [..._commands], views: [..._views], sidebar: [..._sidebar] };
}

// --- Runtime injected INSIDE the iframe --------------------------------------
// Runs in the sandbox's opaque origin. Exposes `gnosi` and acts as a bridge with the
// host via postMessage. Kept small and without dependencies.
function _runtimeSource() {
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

function _buildSrcdoc(pluginCode) {
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
    const safeCode = String(pluginCode || '').replace(/<\/(script)/gi, '<\\/$1');
    return `<!doctype html><html><head><meta charset="utf-8">`
        + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
        + `</head><body>`
        + `<script>${safeRuntime}</script>`
        + `<script type="module">${safeCode}</script>`
        + `</body></html>`;
}

// --- Host handlers for the plugin's calls (gated by permission) --------
const _HOST_METHODS = {
    'vault.readPage': { perm: 'vault:read', run: async (args) => {
        const id = String(args.pageId || '');
        const res = await axios.get(`/api/vault/pages/${encodeURIComponent(id)}`);
        const d = res.data || {};
        // Unified shape with the data sandbox: {pageId, title, content, metadata}.
        return { pageId: d.id, title: d.title || '', content: d.content || '', metadata: d.metadata || {} };
    } },
    'vault.writePage': { perm: 'vault:write', run: async (args) => {
        const id = String(args.pageId || '');
        // Partial update (PATCH preserves the frontmatter): content and/or metadata.
        const payload = {};
        if (args.content !== undefined) payload.content = args.content;
        if (args.metadata !== undefined) payload.metadata = args.metadata;
        await axios.patch(`/api/vault/pages/${encodeURIComponent(id)}`, payload);
        return { pageId: id, written: (args.content || '').length };
    } },
    'vault.queryDB': { perm: 'vault:read', run: async (args) => {
        const id = String(args.tableId || '');
        const limit = Math.max(1, Math.min(Number(args.limit) || 200, 1000));
        const res = await axios.get(`/api/vault/pages/by-table/${encodeURIComponent(id)}`);
        const all = Array.isArray(res.data) ? res.data : [];
        // Templates (is_template) are not data: no other consumer of
        // by-table shows them as rows (DbViewEmbed, PageViewModal,
        // dashboard, sidebar). Without this filter a plugin would receive them
        // mixed in with the records — and `total`/`truncated` counted them.
        const records = all.filter((p) => !(p.metadata || {}).is_template);
        const rows = records.slice(0, limit).map((p) => ({ id: p.id, title: p.title, metadata: p.metadata || {} }));
        return { tableId: id, rows, total: records.length, truncated: records.length > limit };
    } },
    'vault.listTables': { perm: 'vault:read', run: async () => {
        const res = await axios.get('/api/vault/tables');
        const all = Array.isArray(res.data) ? res.data : [];
        return { tables: all.map((t) => ({ id: t.id, name: t.name || t.id, fields: (t.properties || []).length })) };
    } },
    'vault.createPage': { perm: 'vault:write', run: async (args) => {
        const res = await axios.post('/api/vault/pages', {
            title: args.title || 'Sense títol',
            content: args.content || '',
            metadata: {},
            ...(args.parent_id ? { parent_id: args.parent_id } : {}),
        });
        return { pageId: res.data?.id, title: res.data?.title };
    } },
    'settings.get': { perm: 'settings', run: async (args, pluginId) => {
        const res = await axios.get(`/api/vault/plugins/${encodeURIComponent(pluginId)}/settings`);
        return { settings: res.data?.settings || {} };
    } },
    'settings.set': { perm: 'settings', run: async (args, pluginId) => {
        const res = await axios.put(`/api/vault/plugins/${encodeURIComponent(pluginId)}/settings`, { settings: args.settings || {} });
        return { settings: res.data?.settings || {} };
    } },
    'network.fetch': { perm: 'network', run: async (args, pluginId) => {
        const res = await axios.post(
            `/api/vault/plugins/${encodeURIComponent(pluginId)}/network/fetch`,
            { url: args.url, opts: args.opts || {} },
        );
        return res.data;
    } },
};

function _onMessage(entry, ev) {
    const m = ev.data || {};
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
    } else if (m.type === 'log') {
        console[m.level === 'error' ? 'error' : m.level === 'warn' ? 'warn' : 'log'](`[plugin ${pid}]`, m.message);
    } else if (m.type === 'host-call') {
        const def = _HOST_METHODS[m.method];
        const reply = (ok, payload) => iframe.contentWindow.postMessage(
            { __gnosi_host: true, type: 'host-result', id: m.id, ok, ...(ok ? { result: payload } : { error: payload }) }, '*');
        if (!def) { reply(false, `mètode desconegut: ${m.method}`); return; }
        if (!granted.includes(def.perm)) { reply(false, `permís denegat: ${def.perm}`); return; }
        def.run(m.args || {}, pid).then((r) => reply(true, r)).catch((e) => reply(false, String(e?.message || e)));
    }
}

function _mountPlugin(manifest, granted, code) {
    const pid = manifest.id;
    _unmountPlugin(pid);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('title', `plugin:${pid}`);
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
    iframe.srcdoc = _buildSrcdoc(code);
    const entry = { iframe, manifest, granted };
    const listener = (ev) => _onMessage(entry, ev);
    entry.listener = listener;
    window.addEventListener('message', listener);
    document.body.appendChild(iframe);
    _frames.set(pid, entry);
}

function _unmountPlugin(pid) {
    const entry = _frames.get(pid);
    if (!entry) return;
    window.removeEventListener('message', entry.listener);
    try { entry.iframe.remove(); } catch { /* noop */ }
    _frames.delete(pid);
    _commands = _commands.filter((c) => c.pluginId !== pid);
    _views = _views.filter((v) => v.pluginId !== pid);
    _sidebar = _sidebar.filter((s) => s.pluginId !== pid);
    _notify();
}

/** Sends an execution call (command/view/panel) to the plugin's iframe. */
export function runCommand(pluginId, commandId, arg) {
    const entry = _frames.get(pluginId);
    if (!entry) return;
    entry.iframe.contentWindow.postMessage(
        { __gnosi_host: true, type: 'run', kind: 'cmd', id: commandId, arg: arg || null }, '*');
}

/** Loads (or reloads) all installed and active third-party plugins. */
export async function loadPlugins() {
    let installed;
    try {
        const res = await axios.get(`${API}/installed`);
        installed = res.data?.plugins || [];
    } catch {
        return;
    }
    const seen = new Set();
    for (const p of installed) {
        const manifest = p.manifest;
        if (!manifest || !p.enabled) continue;
        const granted = p.granted || [];
        const wantsUI = ['ui:command', 'ui:view', 'ui:sidebar'].some((x) => granted.includes(x));
        if (!manifest.main || !wantsUI) continue;
        seen.add(manifest.id);
        try {
            const res = await axios.get(`${API}/${encodeURIComponent(manifest.id)}/asset/${manifest.main}`, { responseType: 'text' });
            _mountPlugin(manifest, granted, res.data);
        } catch (e) {
            console.warn(`[plugins] could not load ${manifest.id}:`, e?.message || e);
        }
    }
    // Unmounts the ones that no longer apply (disabled or uninstalled).
    for (const pid of [..._frames.keys()]) {
        if (!seen.has(pid)) _unmountPlugin(pid);
    }
    _loaded = true;
}

export function isLoaded() { return _loaded; }
