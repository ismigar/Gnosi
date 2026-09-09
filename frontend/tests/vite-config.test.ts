// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { loadConfigFromFile, type ConfigEnv, type Plugin, type UserConfig } from 'vite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const configPath = fileURLToPath(new URL('../vite.config.js', import.meta.url));
let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'gnosi-vite-config-'));
  // Evaluate the real config without loading checkout/user env files or certs.
  vi.spyOn(process, 'cwd').mockReturnValue(temporaryDirectory);
  vi.stubEnv('VITE_BASE_PATH', undefined);
  vi.stubEnv('VITE_DEV_HTTPS', 'false');
  vi.stubEnv('__GNOSI_DEV_HTTPS_CACHE', undefined);
  vi.stubEnv('CHOKIDAR_USEPOLLING', undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function configured(environment: ConfigEnv): Promise<UserConfig> {
  const result = await loadConfigFromFile(
    environment, configPath, temporaryDirectory, 'silent', undefined, 'native',
  );
  if (!result) throw new Error('Expected the real frontend configuration');
  return result.config;
}

async function configuredBase(environment: ConfigEnv): Promise<string | undefined> {
  return (await configured(environment)).base;
}

const environments: ConfigEnv[] = [
  { command: 'build', mode: 'production' },
  { command: 'serve', mode: 'development' },
  { command: 'serve', mode: 'production', isPreview: true },
];

for (const environment of environments) {
  it(`uses origin-root assets for ${environment.command}/${environment.mode}/${String(environment.isPreview)}`, async () => {
    expect(await configuredBase(environment)).toBe('/');
    vi.stubEnv('VITE_BASE_PATH', '');
    expect(await configuredBase(environment)).toBe('/');
  });
}

it.each(['./', '/gnosi-assets/', 'https://static.example.invalid/gnosi/'])(
  'preserves explicit asset base %s without implying a router basename', async base => {
    vi.stubEnv('VITE_BASE_PATH', base);
    expect(await configuredBase({ command: 'build', mode: 'production' })).toBe(base);
  },
);

it('retains process-over-local-file precedence for explicit asset bases', async () => {
  writeFileSync(join(temporaryDirectory, '.env'), 'VITE_BASE_PATH=/fixture-assets/\n');
  expect(await configuredBase({ command: 'build', mode: 'production' })).toBe('/fixture-assets/');
  vi.stubEnv('VITE_BASE_PATH', '/process-assets/');
  expect(await configuredBase({ command: 'build', mode: 'production' })).toBe('/process-assets/');
});

it.each(environments)(
  'deduplicates Yjs for $command/$mode/$isPreview',
  async environment => {
    const config = await configured(environment);
    expect(config.resolve?.dedupe).toContain('yjs');
  },
);

it.each(environments)(
  'keeps per-icon Lucide imports lazy for $command/$mode/$isPreview',
  async environment => {
    const config = await configured(environment);
    expect(config.optimizeDeps?.exclude).toContain('lucide-react/dynamic');
  },
);

it('groups only the reviewed shell icons without capturing the dynamic catalogue or shared runtimes', async () => {
  const config = await configured({ command: 'build', mode: 'production' });
  const output = config.build?.rolldownOptions?.output;
  if (!output || Array.isArray(output)) throw new Error('Expected one build output');
  const splitting = output.codeSplitting;
  if (!splitting || typeof splitting !== 'object') throw new Error('Expected scoped code splitting');
  expect(splitting.groups).toHaveLength(1);
  const group = splitting.groups?.[0];
  if (!group || typeof group.test !== 'function') throw new Error('Expected a shell icon selector');
  const matches = group.test;
  expect(group.name).toBe('shell-icons');
  expect(group.includeDependenciesRecursively).toBe(false);
  expect(splitting.minSize).toBeUndefined();

  const expected = [
    'book-open', 'bot', 'briefcase', 'calendar', 'calendar-range', 'chevron-down',
    'circle-question-mark', 'clock', 'command', 'database', 'download', 'file-text',
    'folder', 'gauge', 'hash', 'image', 'inbox', 'layout-panel-left', 'library-big',
    'list-tree', 'loader', 'loader-circle', 'log-in', 'log-out', 'mail', 'menu',
    'message-circle', 'message-square', 'monitor', 'moon', 'network', 'notebook-tabs',
    'panel-bottom-close', 'panel-top-open', 'pen-tool', 'plus', 'presentation',
    'puzzle', 'refresh-cw', 'search', 'settings', 'share-2', 'shield', 'sparkles',
    'star', 'sun', 'upload', 'user', 'user-plus', 'users', 'vault',
  ];
  expect(expected).toHaveLength(51);
  const iconsDirectory = fileURLToPath(new URL('../node_modules/lucide-react/dist/esm/icons/', import.meta.url));
  const catalogue = readdirSync(iconsDirectory).filter(name => /\.m?js$/u.test(name));
  expect(catalogue.length).toBeGreaterThan(1000);
  const selected = catalogue.filter(name => matches(join(iconsDirectory, name)))
    .map(name => name.replace(/\.m?js$/u, ''));
  expect(selected.sort()).toEqual([...expected].sort());
  const packagePath = '/checkout/node_modules/.pnpm/lucide-react@1.34.0/node_modules/lucide-react';
  for (const icon of expected) {
    expect(group.test(`${packagePath}/dist/esm/icons/${icon}.mjs`), icon).toBe(true);
  }
  expect(group.test('C:\\checkout\\node_modules\\lucide-react\\dist\\esm\\icons\\mail.mjs')).toBe(true);
  for (const excluded of [
    'dist/esm/icons/a-arrow-down.mjs',
    'dist/esm/icons/zap.mjs',
    'dist/esm/icons/index.mjs',
    'dist/esm/dynamic.mjs',
    'dist/esm/DynamicIcon.mjs',
    'dist/esm/dynamicIconImports.mjs',
    'dist/esm/lucide-react.mjs',
    'dist/esm/createLucideIcon.mjs',
    'dist/esm/Icon.mjs',
  ]) {
    expect(group.test(`${packagePath}/${excluded}`), excluded).toBe(false);
  }
  expect(group.test('/checkout/node_modules/react/index.js')).toBe(false);
  expect(group.test('/checkout/src/features/settings/icons/mail.mjs')).toBe(false);
  expect(config.optimizeDeps?.exclude).toContain('lucide-react/dynamic');
});

it('uses native file events unless polling is explicitly requested', async () => {
  const environment: ConfigEnv = { command: 'serve', mode: 'development' };
  expect((await configured(environment)).server?.watch?.usePolling).toBe(false);
  vi.stubEnv('CHOKIDAR_USEPOLLING', 'true');
  expect((await configured(environment)).server?.watch?.usePolling).toBe(true);
  vi.stubEnv('CHOKIDAR_USEPOLLING', '0');
  expect((await configured(environment)).server?.watch?.usePolling).toBe(false);
});

it('keeps compiled preview on the configured native port and backend', async () => {
  vi.stubEnv('VITE_FRONTEND_PORT', '5189');
  vi.stubEnv('VITE_BACKEND_PORT', '5019');
  vi.stubEnv('VITE_BACKEND_HOST', '127.0.0.1');
  const config = await configured({ command: 'serve', mode: 'production', isPreview: true });
  expect(config.preview).toMatchObject({ host: '127.0.0.1', port: 5189, strictPort: true });
  expect(config.preview?.proxy).toEqual(config.server?.proxy);
  expect(config.preview?.proxy?.['/api']).toMatchObject({ target: 'http://127.0.0.1:5019', ws: true });
});

class ProtocolSocket extends EventEmitter {
  chunks: Array<Buffer | null> = [];
  read = () => this.chunks.shift() ?? null;
  unshift = vi.fn();
  end = vi.fn();
}

for (const hookName of ['configureServer', 'configurePreviewServer'] as const) {
  async function protocolServer(https: object | null = {}) {
    const config = await configured({ command: 'serve', mode: 'production', isPreview: true });
    const plugin = config.plugins?.flat().find(item =>
      item && typeof item === 'object' && 'name' in item && item.name === 'gnosi:http-to-https-redirect',
    ) as Plugin;
    const hook = plugin[hookName];
    if (typeof hook !== 'function') throw new Error(`Missing ${hookName}`);
    const httpServer = new EventEmitter();
    const tls = vi.fn();
    httpServer.on('connection', tls);
    Reflect.apply(hook, plugin, [{
      httpServer,
      config: { server: { https, port: 5189 }, preview: { port: 5189 } },
    }]);
    return { httpServer, tls };
  }

  it(`${hookName} redirects plain HTTP preserving the path and query`, async () => {
    const { httpServer, tls } = await protocolServer();
    const socket = new ProtocolSocket();
    socket.chunks.push(Buffer.from('GET /@principal/calendar?view=month HTTP/1.1\r\nHost: localhost:5189\r\n\r\n'));
    httpServer.emit('connection', socket);
    expect(socket.end).toHaveBeenCalledWith(expect.stringContaining(
      'HTTP/1.1 307 Temporary Redirect\r\nLocation: https://localhost:5189/@principal/calendar?view=month\r\n',
    ));
    expect(tls).not.toHaveBeenCalled();
  });

  it(`${hookName} waits for readable bytes and preserves the TLS handshake`, async () => {
    const { httpServer, tls } = await protocolServer();
    const socket = new ProtocolSocket();
    httpServer.emit('connection', socket);
    expect(tls).not.toHaveBeenCalled();
    const hello = Buffer.from([0x16, 0x03, 0x03]);
    socket.chunks.push(hello);
    socket.emit('readable');
    expect(socket.unshift).toHaveBeenCalledWith(hello);
    expect(tls).toHaveBeenCalledExactlyOnceWith(socket);
    expect(socket.end).not.toHaveBeenCalled();
  });

  it(`${hookName} leaves an explicitly HTTP server unchanged`, async () => {
    const { httpServer, tls } = await protocolServer(null);
    expect(httpServer.listeners('connection')).toEqual([tls]);
  });
}
