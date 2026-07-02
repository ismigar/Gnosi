/**
 * host.js — amfitrió de plugins de TERCERS al frontend (fases 1-2 i 4 de
 * plugin_system.md).
 *
 * Carrega cada plugin de UI dins d'un IFRAME sandbox (`sandbox="allow-scripts"`,
 * SENSE allow-same-origin → origen opac: no pot llegir el DOM del pare, ni les
 * cookies, ni fer peticions same-origin al backend). Tota comunicació passa per
 * `postMessage`. Una CSP dins del srcdoc bloqueja la xarxa tret que el plugin
 * tingui el permís `network`. Així un plugin no pot fer RCE ni exfiltrar dades:
 * només pot fer el que declara al manifest i l'usuari ha aprovat.
 *
 * Punts d'extensió exposats al plugin (objecte global `gnosi` dins l'iframe):
 *   gnosi.registerCommand({id, title, icon?, run})   → paleta de comandes
 *   gnosi.registerView({id, title, icon?, render})    → vista pròpia
 *   gnosi.registerSidebarPanel({id, title, render})   → panell lateral
 *   gnosi.vault.readPage(id) / writePage(id, content) → API de dades (gated)
 *   gnosi.fetch(url, opts)                             → xarxa (gated)
 *   gnosi.log/warn/error(...)                          → consola del host
 *
 * Store a nivell de mòdul amb subscripció (mateix patró que usePlugins): la
 * paleta, el shell i el panell de config llegeixen les contribucions actives.
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

// --- Runtime injectat DINS de l'iframe --------------------------------------
// S'executa a l'origen opac del sandbox. Exposa `gnosi` i fa de pont amb el
// host per postMessage. Es manté petit i sense dependències.
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

function _buildSrcdoc(pluginCode, granted) {
    const net = granted.includes('network');
    // Sense permís de xarxa: connect-src 'none' talla fetch/XHR/WebSocket.
    // (Les crides al host van per postMessage, que la CSP no afecta.)
    const csp = [
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        net ? "connect-src https: http:" : "connect-src 'none'",
        net ? "img-src https: http: data:" : "img-src data:",
    ].join('; ');
    // Evita que un `</script>` dins del codi del plugin trenqui el document.
    const safeRuntime = _runtimeSource().replace(/<\/(script)/gi, '<\\/$1');
    const safeCode = String(pluginCode || '').replace(/<\/(script)/gi, '<\\/$1');
    return `<!doctype html><html><head><meta charset="utf-8">`
        + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
        + `</head><body>`
        + `<script>${safeRuntime}</script>`
        + `<script type="module">${safeCode}</script>`
        + `</body></html>`;
}

// --- Handlers del host per a les crides del plugin (gated per permís) --------
const _HOST_METHODS = {
    'vault.readPage': { perm: 'vault:read', run: async (args) => {
        const id = String(args.pageId || '');
        const res = await axios.get(`/api/vault/pages/${encodeURIComponent(id)}`);
        const d = res.data || {};
        // Forma unificada amb el sandbox de dades: {pageId, title, content, metadata}.
        return { pageId: d.id, title: d.title || '', content: d.content || '', metadata: d.metadata || {} };
    } },
    'vault.writePage': { perm: 'vault:write', run: async (args) => {
        const id = String(args.pageId || '');
        // Actualització parcial (PATCH preserva el frontmatter): content i/o metadata.
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
        const rows = all.slice(0, limit).map((p) => ({ id: p.id, title: p.title, metadata: p.metadata || {} }));
        return { tableId: id, rows, total: all.length, truncated: all.length > limit };
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
    'network.fetch': { perm: 'network', run: async (args) => {
        const res = await fetch(args.url, args.opts || {});
        return { status: res.status, body: await res.text() };
    } },
};

function _onMessage(entry, ev) {
    const m = ev.data || {};
    if (!m.__gnosi) return;
    // Assegura que el missatge ve de l'iframe d'AQUEST plugin.
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
    iframe.srcdoc = _buildSrcdoc(code, granted);
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

/** Envia una crida d'execució (comanda/vista/panell) a l'iframe del plugin. */
export function runCommand(pluginId, commandId, arg) {
    const entry = _frames.get(pluginId);
    if (!entry) return;
    entry.iframe.contentWindow.postMessage(
        { __gnosi_host: true, type: 'run', kind: 'cmd', id: commandId, arg: arg || null }, '*');
}

/** Carrega (o recarrega) tots els plugins de tercers instal·lats i actius. */
export async function loadPlugins() {
    let installed = [];
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
            console.warn(`[plugins] no s'ha pogut carregar ${manifest.id}:`, e?.message || e);
        }
    }
    // Desmunta els que ja no toca (desactivats o desinstal·lats).
    for (const pid of [..._frames.keys()]) {
        if (!seen.has(pid)) _unmountPlugin(pid);
    }
    _loaded = true;
}

export function isLoaded() { return _loaded; }
