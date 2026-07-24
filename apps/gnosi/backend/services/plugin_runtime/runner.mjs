/**
 * runner.mjs — execution harness for a Gnosi DATA plugin inside a
 * restricted Node subprocess (phase 3 of plugin_system.md).
 *
 * The Python backend (plugin_sandbox.py) launches this script with:
 *   node --permission --allow-fs-read=<pluginDir> runner.mjs
 * and passes it, via stdin, the event to process. The plugin can ONLY touch
 * the vault through the `api` object, which forwards each call to the host via
 * JSON-RPC over stdio; the host validates each call against the granted permissions.
 *
 * Protocol (JSON lines ending in \n):
 *   host → runner:  {"type":"event","event":{"name","payload"}}
 *   host → runner:  {"type":"rpc-result","id","ok",("result"|"error")}
 *   runner → host:  {"type":"rpc","id","method","args"}
 *   runner → host:  {"type":"log","level","message"}
 *   runner → host:  {"type":"done"}  |  {"type":"error","message"}
 *
 * Sandbox: --permission (host Node) blocks fs-write, child_process, worker and
 * native addons. If the plugin does NOT have the `network` permission, the network block
 * here is HARD: a synchronous ESM resolution hook (`module.registerHooks`,
 * without a worker → compatible with --permission) makes every `import` of
 * network modules throw (node:net/http/https/tls/dgram/http2 + node:module to close
 * the escape hatch via createRequire), and the network globals are neutralized (fetch,
 * WebSocket, XMLHttpRequest, EventSource). Combined with child_process/worker/addons
 * already blocked by Node, an ESM plugin cannot open any network connection.
 */
import { registerHooks } from 'node:module';

const PLUGIN_MAIN = process.env.GNOSI_PLUGIN_MAIN;
const NET_ALLOWED = process.env.GNOSI_PLUGIN_NET === '1';

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// --- HARD network block if the `network` permission has not been granted -----------
if (!NET_ALLOWED) {
  const BLOCKED = new Set([
    'net', 'node:net', 'http', 'node:http', 'https', 'node:https',
    'tls', 'node:tls', 'dgram', 'node:dgram', 'http2', 'node:http2',
    'module', 'node:module', // closes over createRequire → require('net')
  ]);
  registerHooks({
    resolve(spec, ctx, next) {
      if (BLOCKED.has(spec)) throw new Error(`network blocked by sandbox: ${spec}`);
      return next(spec, ctx);
    },
  });
  const denied = () => { throw new Error('network permission not granted'); };
  try { globalThis.fetch = denied; } catch { /* read-only */ }
  try { globalThis.WebSocket = undefined; } catch { /* noop */ }
  try { globalThis.XMLHttpRequest = undefined; } catch { /* noop */ }
  try { globalThis.EventSource = undefined; } catch { /* noop */ }
  // Defense-in-depth: the module-resolution hook and global shadowing above do
  // not cover Node's internal C++ bindings (`process.binding` /
  // `process._linkedBinding` → 'tcp_wrap', 'udp_wrap', ...), through which a
  // plugin could open a socket without ever importing 'net'. Neutralize them.
  // The real boundary should still be an OS-level egress restriction.
  try { process.binding = () => { throw new Error('network blocked by sandbox'); }; } catch { /* noop */ }
  try { process._linkedBinding = () => { throw new Error('network blocked by sandbox'); }; } catch { /* noop */ }
}

// --- Bridge RPC to the host --------------------------------------------------
let _rpcSeq = 0;
const _pending = new Map();

function rpc(method, args) {
  const id = `r${++_rpcSeq}`;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    send({ type: 'rpc', id, method, args: args || {} });
  });
}

function makeApi(event) {
  const log = (level, ...parts) =>
    send({ type: 'log', level, message: parts.map(String).join(' ') });
  return {
    event,
    log: (...a) => log('info', ...a),
    warn: (...a) => log('warn', ...a),
    error: (...a) => log('error', ...a),
    vault: {
      readPage: (pageId) => rpc('vault.readPage', { pageId }),
      writePage: (pageId, content) => rpc('vault.writePage', { pageId, content }),
      createPage: (opts) => rpc('vault.createPage', opts || {}),
      queryDB: (tableId, opts) => rpc('vault.queryDB', { tableId, limit: (opts && opts.limit) || 200 }),
      listTables: () => rpc('vault.listTables', {}),
    },
    settings: {
      get: () => rpc('settings.get', {}),
      set: (settings) => rpc('settings.set', { settings }),
    },
    fetch: NET_ALLOWED
      ? (url, opts) => rpc('network.fetch', { url, opts })
      : () => { throw new Error('network permission not granted'); },
  };
}

// --- Reading lines from stdin ----------------------------------------------
let _buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  _buf += chunk;
  let nl;
  while ((nl = _buf.indexOf('\n')) >= 0) {
    const line = _buf.slice(0, nl);
    _buf = _buf.slice(nl + 1);
    if (line.trim()) handleLine(line);
  }
});
process.stdin.on('end', () => process.exit(0));

let _plugin = null;

async function handleLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.type === 'rpc-result') {
    const p = _pending.get(msg.id);
    if (!p) return;
    _pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error || 'rpc error'));
    return;
  }
  if (msg.type === 'event') {
    try {
      const mod = _plugin || (_plugin = await import(PLUGIN_MAIN));
      const handler =
        (mod.default && typeof mod.default === 'object' && mod.default.onEvent) ||
        mod.onEvent ||
        (typeof mod.default === 'function' ? mod.default : null);
      if (typeof handler !== 'function') {
        send({ type: 'error', message: 'el plugin no exporta onEvent(event, api)' });
        process.exit(0);
        return;
      }
      const api = makeApi(msg.event);
      await handler(msg.event, api);
      send({ type: 'done' });
    } catch (e) {
      send({ type: 'error', message: (e && e.message) || String(e) });
    } finally {
      process.exit(0);
    }
  }
}
