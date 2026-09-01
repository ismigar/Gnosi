const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { launchBackend, probeBackend, stopBackend } = require('./backend-process');

const identity = 'b'.repeat(64);
const body = JSON.stringify({ status: 'ok', mode: 'FastAPI' });

async function serverFixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return `http://127.0.0.1:${server.address().port}/api/health`;
}

for (const [name, status, marker, payload, expected] of [
  ['own healthy process', 200, identity, body, true],
  ['another Gnosi process', 200, 'a'.repeat(64), body, false],
  ['unrelated HTTP 200', 200, undefined, body, false],
  ['redirect', 302, identity, body, false],
  ['not ready', 503, identity, body, false],
  ['wrong service payload', 200, identity, '{"status":"ok"}', false],
  ['malformed JSON', 200, identity, 'broken', false],
  ['oversized payload', 200, identity, ' '.repeat(4097), false],
]) {
  test(`probe accepts only a complete own response: ${name}`, async t => {
    const url = await serverFixture(t, (_request, response) => {
      response.writeHead(status, marker ? { 'x-gnosi-desktop-instance': marker } : {});
      response.end(payload);
    });
    assert.equal(await probeBackend(url, identity, 500), expected);
  });
}

for (const trickle of [false, true]) {
  test(`absolute timeout closes a ${trickle ? 'trickling' : 'hung'} response`, async t => {
    let stopped;
    const closed = new Promise(resolve => { stopped = resolve; });
    const url = await serverFixture(t, (_request, response) => {
      response.writeHead(200, { 'x-gnosi-desktop-instance': identity });
      const timer = trickle ? setInterval(() => response.write(' '), 5) : null;
      response.on('close', () => { clearInterval(timer); stopped(); });
    });
    assert.equal(await probeBackend(url, identity, 70), false);
    await closed;
  });
}

test('probe rejects non-loopback targets and accepts cancellation without a request', async () => {
  await assert.rejects(probeBackend('https://example.invalid/api/health', identity, 50), /loopback/);
  assert.equal(await probeBackend('http://127.0.0.1:1/api/health', identity, 50, AbortSignal.abort()), false);
});

async function reservedPort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function childOptions(t, script, port, overrides = {}) {
  let child;
  t.after(async () => { if (child) await stopBackend(child, 100); });
  return {
    executable: process.execPath,
    args: ['-e', script], cwd: __dirname,
    environment: { PATH: process.env.PATH, GNOSI_DESKTOP_INSTANCE: 'inherited-must-not-win' },
    healthUrl: `http://127.0.0.1:${port}/api/health`,
    startupTimeoutMs: 1500, requestTimeoutMs: 100, pollIntervalMs: 10,
    onSpawn: process => { child = process; },
    ...overrides,
  };
}

test('real child readiness, live status and shutdown use its unique marker', async t => {
  const port = await reservedPort();
  const script = `require('http').createServer((req,res) => {
    res.setHeader('x-gnosi-desktop-instance', process.env.GNOSI_DESKTOP_INSTANCE);
    res.end(${JSON.stringify(body)});
  }).listen(${port},'127.0.0.1');`;
  const handle = await launchBackend(childOptions(t, script, port));
  assert.equal(await handle.isRunning(), true);
  await handle.stop();
  assert.notEqual(handle.process.signalCode, null);
  assert.equal(await handle.isRunning(), false);
});

test('crashed child rejects immediately without accepting an occupied HTTP 200', async t => {
  const url = await serverFixture(t, (_request, response) => response.end(body));
  const options = childOptions(t, 'process.exit(23)', new URL(url).port);
  await assert.rejects(launchBackend(options), /exited before readiness/);
});

test('a live but unready child cannot pass and is reaped after the deadline', async t => {
  const port = await reservedPort();
  let child;
  const options = childOptions(t, 'setInterval(() => {}, 1000)', port, {
    startupTimeoutMs: 120,
    onSpawn: process => { child = process; },
  });
  await assert.rejects(launchBackend(options), /startup timed out/);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test('missing executable rejects instead of waiting or reporting readiness', async t => {
  const options = childOptions(t, '', await reservedPort(), { executable: '/nonexistent/gnosi-fixture-backend' });
  await assert.rejects(launchBackend(options), /ENOENT/);
});

for (const missing of [false, true]) {
  test(`throwing launch callback safely cleans up a ${missing ? 'missing' : 'live'} child`, async t => {
    let child;
    const failure = new Error('Fixture callback failed');
    const options = childOptions(t, 'setInterval(() => {}, 1000)', 1, {
      ...(missing ? { executable: '/nonexistent/gnosi-fixture-backend' } : {}),
      onSpawn: process => { child = process; throw failure; },
    });
    await assert.rejects(launchBackend(options), error => error === failure);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(child.pid === undefined || child.exitCode !== null || child.signalCode !== null);
  });
}
