/**
 * runner.mjs — arnès d'execució d'un plugin de DADES de Gnosi dins d'un
 * subprocés Node capat (fase 3 de plugin_system.md).
 *
 * El backend Python (plugin_sandbox.py) arrenca aquest script amb:
 *   node --permission --allow-fs-read=<pluginDir> runner.mjs
 * i li passa, via stdin, l'esdeveniment a processar. El plugin NOMÉS pot tocar
 * el vault a través de l'objecte `api`, que reenvia cada crida al host per
 * JSON-RPC sobre stdio; el host valida cada crida contra els permisos concedits.
 *
 * Protocol (línies JSON acabades en \n):
 *   host → runner:  {"type":"event","event":{"name","payload"}}
 *   host → runner:  {"type":"rpc-result","id","ok",("result"|"error")}
 *   runner → host:  {"type":"rpc","id","method","args"}
 *   runner → host:  {"type":"log","level","message"}
 *   runner → host:  {"type":"done"}  |  {"type":"error","message"}
 *
 * Sandbox: --permission (host Node) bloqueja fs-write, child_process, worker i
 * native addons. Si el plugin NO té permís `network`, aquí el bloqueig de xarxa
 * és DUR: un hook de resolució ESM (`module.registerHooks`, síncron, sense
 * worker → compatible amb --permission) fa petar tot `import` de mòduls de
 * xarxa (node:net/http/https/tls/dgram/http2 + node:module per tancar l'escapada
 * via createRequire), i es neutralitzen els globals de xarxa (fetch, WebSocket,
 * XMLHttpRequest, EventSource). Combinat amb child_process/worker/addons ja
 * bloquejats per Node, un plugin ESM no pot obrir cap connexió de xarxa.
 */
import { registerHooks } from 'node:module';

const PLUGIN_MAIN = process.env.GNOSI_PLUGIN_MAIN;
const NET_ALLOWED = process.env.GNOSI_PLUGIN_NET === '1';

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// --- Bloqueig DUR de xarxa si no s'ha concedit el permís `network` -----------
if (!NET_ALLOWED) {
  const BLOCKED = new Set([
    'net', 'node:net', 'http', 'node:http', 'https', 'node:https',
    'tls', 'node:tls', 'dgram', 'node:dgram', 'http2', 'node:http2',
    'module', 'node:module', // tanca createRequire → require('net')
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
}

// --- Bridge RPC cap al host --------------------------------------------------
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

// --- Lectura de línies de stdin ----------------------------------------------
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
