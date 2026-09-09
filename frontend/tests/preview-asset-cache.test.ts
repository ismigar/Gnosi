// @vitest-environment node
import { createServer, IncomingMessage, ServerResponse, type Server } from 'node:http';
import { Socket } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  build, loadConfigFromFile, preview,
  type Connect, type Manifest, type Plugin, type PreviewServer,
} from 'vite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const configPath = fileURLToPath(new URL('../vite.config.js', import.meta.url));
const immutable = 'public, max-age=31536000, immutable';
let root: string;
const previews: PreviewServer[] = [];
const upstreams: Server[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gnosi-preview-assets-'));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.stubEnv('VITE_DEV_HTTPS', 'false');
  vi.stubEnv('__GNOSI_DEV_HTTPS_CACHE', undefined);
  vi.stubEnv('VITE_BASE_PATH', undefined);
});

afterEach(async () => {
  for (const server of previews.splice(0)) await server.close();
  for (const server of upstreams.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close(error => { if (error) reject(error); else resolve(); });
    });
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function assetMiddleware(base: string, withManifest = true): Promise<Connect.NextHandleFunction> {
  const directory = join(root, 'dist');
  mkdirSync(join(directory, 'assets'), { recursive: true });
  writeFileSync(join(directory, 'assets/app-ABcd1234.js'), 'fixture');
  writeFileSync(join(directory, 'assets/public-ABcd1234.js'), 'public fixture');
  if (withManifest) {
    mkdirSync(join(directory, '.vite'));
    writeFileSync(join(directory, '.vite/manifest.json'), JSON.stringify({
      'index.html': { file: 'assets/app-ABcd1234.js' },
      'missing.js': { file: 'assets/missing-ABcd1234.js' },
      'unhashed.js': { file: 'assets/app.js' },
    }));
  }
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'production', isPreview: true },
    configPath, root, 'silent', undefined, 'native',
  );
  const plugin = loaded?.config.plugins?.flat().find(item => (
    item && typeof item === 'object' && 'name' in item
      && item.name === 'gnosi:immutable-preview-assets'
  )) as Plugin | undefined;
  const hook = plugin?.configurePreviewServer;
  if (typeof hook !== 'function') throw new Error('Expected preview asset cache plugin');
  const use = vi.fn<(middleware: Connect.NextHandleFunction) => void>();
  Reflect.apply(hook, plugin, [{
    config: {
      root, base,
      environments: { client: { build: { outDir: 'dist', manifest: true, assetsDir: 'assets' } } },
    },
    middlewares: { use },
  }]);
  const middleware = use.mock.calls[0]?.[0];
  if (!middleware) throw new Error('Expected preview middleware');
  return middleware;
}

function responseHeaders(
  middleware: Connect.NextHandleFunction, url: string,
  { servedUrl = url, status = 200, method = 'GET' } = {},
) {
  const req = new IncomingMessage(new Socket());
  req.url = url;
  req.method = method;
  const res = new ServerResponse(req);
  middleware(req, res, () => {
    req.url = servedUrl;
    res.writeHead(status);
  });
  return res.getHeaders();
}

it.each(['/', '/fixture/', 'https://static.example.invalid/fixture/'])(
  'matches exact manifest members under base %s and excludes missing files and fallbacks', async base => {
    const middleware = await assetMiddleware(base);
    const prefix = new URL(base, 'http://preview.invalid').pathname.replace(/\/$/, '');
    const asset = '/assets/app-ABcd1234.js';
    expect(responseHeaders(middleware, `${prefix}${asset}?v=1`, { servedUrl: `${asset}?v=1` })['cache-control'])
      .toBe(immutable);
    expect(responseHeaders(middleware, `${prefix}${asset}`, { servedUrl: asset, status: 304 })['cache-control'])
      .toBe(immutable);
    for (const file of ['missing-ABcd1234.js', 'public-ABcd1234.js', 'app.js']) {
      expect(responseHeaders(middleware, `${prefix}/assets/${file}`)['cache-control']).toBeUndefined();
    }
    expect(responseHeaders(middleware, `${prefix}${asset}`, { servedUrl: '/index.html' })['cache-control'])
      .toBeUndefined();
    expect(responseHeaders(middleware, `${prefix}${asset}`, { servedUrl: asset, status: 404 })['cache-control'])
      .toBeUndefined();
    expect(responseHeaders(middleware, `/other${asset}`, { servedUrl: asset })['cache-control'])
      .toBeUndefined();
  },
);

it('leaves older snapshots without a manifest on Vite’s existing cache policy', async () => {
  const middleware = await assetMiddleware('/', false);
  expect(responseHeaders(middleware, '/assets/app-ABcd1234.js')['cache-control']).toBeUndefined();
});

it('removes a copied immutable header from HTML fallback writeHead arguments without changing other headers', async () => {
  const middleware = await assetMiddleware('/');
  for (const arrayHeaders of [false, true]) {
    for (const statusMessage of [false, true]) {
      const req = new IncomingMessage(new Socket());
      req.url = '/assets/app-ABcd1234.js';
      req.method = 'GET';
      const res = new ServerResponse(req);
      const headers = arrayHeaders
        ? ['cAcHe-CoNtRoL', immutable, 'Content-Type', 'text/html', 'X-Fixture', 'retained']
        : { 'cAcHe-CoNtRoL': immutable, 'Content-Type': 'text/html', 'X-Fixture': 'retained' };
      const originalHeaders = structuredClone(headers);
      middleware(req, res, () => {
        req.url = '/index.html';
        if (statusMessage) res.writeHead(200, 'Fixture OK', headers);
        else res.writeHead(200, headers);
      });
      expect(res.getHeader('cache-control')).toBeUndefined();
      expect(res.getHeader('content-type')).toBe('text/html');
      expect(res.getHeader('x-fixture')).toBe('retained');
      expect(res.statusMessage).toBe(statusMessage ? 'Fixture OK' : 'OK');
      expect(headers).toEqual(originalHeaders);
    }
  }
});

function address(server: Pick<Server, 'address'>): string {
  const current = server.address();
  if (!current || typeof current === 'string') throw new Error('Expected a local TCP fixture');
  return `http://127.0.0.1:${String(current.port)}`;
}

it('serves real hashed Vite output with immutable 200/304 while HTML, API, misses and other methods retain their policy', async () => {
  writeFileSync(join(root, 'index.html'), '<div id="fixture"></div><script type="module" src="/main.js"></script>');
  writeFileSync(join(root, 'main.js'), 'import "./style.css"; document.title = "first-build-fixture";');
  writeFileSync(join(root, 'style.css'), 'body { color: rgb(10, 20, 30); }');
  mkdirSync(join(root, 'public'));
  writeFileSync(join(root, 'public/plain.js'), 'public fixture');
  const buildOptions = {
    configFile: configPath, configLoader: 'native' as const, root, envFile: false as const,
    logLevel: 'silent' as const, base: '/fixture/',
    css: { postcss: { plugins: [] } },
    build: { outDir: 'dist', minify: false as const },
  };
  await build(buildOptions);
  const firstManifest = JSON.parse(readFileSync(join(root, 'dist/.vite/manifest.json'), 'utf8')) as Manifest;
  const firstEntry = firstManifest['index.html'];
  if (!firstEntry) throw new Error('Expected compiler manifest entry');

  const upstream = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end('{"fixture":true}');
  });
  upstreams.push(upstream);
  await new Promise<void>(resolve => { upstream.listen(0, '127.0.0.1', resolve); });
  const server = await preview({
    configFile: configPath, configLoader: 'native', root, envFile: false, logLevel: 'silent',
    base: '/fixture/', build: { outDir: 'dist' },
    preview: {
      host: '127.0.0.1', port: 0, strictPort: true,
      proxy: { '/api': { target: address(upstream) } },
    },
  });
  previews.push(server);
  const origin = address(server.httpServer);
  const assetUrl = `${origin}/fixture/${firstEntry.file}`;
  const asset = await fetch(assetUrl);
  expect(asset.status).toBe(200);
  expect(asset.headers.get('cache-control')).toBe(immutable);
  expect(await asset.text()).toContain('first-build-fixture');
  const etag = asset.headers.get('etag');
  if (!etag) throw new Error('Expected Vite asset ETag');
  const validated = await fetch(assetUrl, { headers: { 'If-None-Match': etag } });
  expect(validated.status).toBe(304);
  expect(validated.headers.get('cache-control')).toBe(immutable);
  expect(await validated.text()).toBe('');
  const head = await fetch(assetUrl, { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(head.headers.get('cache-control')).toBe(immutable);
  expect(await head.text()).toBe('');
  const css = firstEntry.css?.[0];
  if (!css) throw new Error('Expected compiled CSS');
  const stylesheet = await fetch(`${origin}/fixture/${css}`);
  expect(stylesheet.status).toBe(200);
  expect(stylesheet.headers.get('cache-control')).toBe(immutable);
  await stylesheet.text();
  for (const pathname of ['/fixture/', '/fixture/@example/media', '/fixture/assets/missing-ABcd1234.js']) {
    const html = await fetch(`${origin}${pathname}`, { headers: { Accept: 'text/html' } });
    expect(html.status).toBe(200);
    expect(html.headers.get('cache-control')).toBe('no-cache');
    expect(html.headers.get('content-type')).toContain('text/html');
    await html.text();
  }
  const missing = await fetch(`${origin}/fixture/assets/missing-ABcd1234.js`, {
    headers: { Accept: 'application/javascript' },
  });
  expect(missing.status).toBe(404);
  expect(missing.headers.get('cache-control') ?? '').not.toContain('immutable');
  await missing.text();
  const api = await fetch(`${origin}/api/fixture`);
  expect(api.status).toBe(200);
  expect(api.headers.get('cache-control')).toBe('no-store');
  await api.text();
  for (const [url, method] of [[assetUrl, 'POST'], [`${origin}/fixture/plain.js`, 'GET']]) {
    if (!url || !method) throw new Error('Expected request fixture');
    const response = await fetch(url, { method });
    expect(response.headers.get('cache-control') ?? '').not.toContain('immutable');
    await response.text();
  }

  // The allowlist is based on real compiler output, and a content change gets a
  // different URL, so a browser cannot reuse the previous build for new code.
  await server.close();
  previews.splice(previews.indexOf(server), 1);
  writeFileSync(join(root, 'main.js'), 'import "./style.css"; document.title = "second-build-fixture";');
  await build(buildOptions);
  const secondManifest = JSON.parse(readFileSync(join(root, 'dist/.vite/manifest.json'), 'utf8')) as Manifest;
  expect(secondManifest['index.html']?.file).not.toBe(firstEntry.file);
}, 30_000);
