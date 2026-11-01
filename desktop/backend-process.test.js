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
  const firstStop = handle.stop();
  assert.equal(handle.stop(), firstStop);
  await firstStop;
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

test('cloud retry reaps the actual failed child before launching the same vault successfully', async t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { launchConfiguredBackend } = require('./vault-startup');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-cloud-retry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const available = path.join(root, 'available');
  const children = [];
  const port = await reservedPort();
  const script = `if (!require('fs').existsSync(process.env.AVAILABLE)) {
    process.stderr.write('GNOSI_STARTUP_ERROR '+process.env.GNOSI_DESKTOP_INSTANCE+' cloud_metadata_unavailable\\n');
    process.exit(74);
  }
  require('http').createServer((req,res) => {
    res.setHeader('x-gnosi-desktop-instance',process.env.GNOSI_DESKTOP_INSTANCE);
    res.end(JSON.stringify({status:'ok',mode:'FastAPI',vault_configured:true}));
  }).listen(${port},'127.0.0.1');`;
  const result = await launchConfiguredBackend({
    environment: { GNOSI_DATA_DIR: path.join(root, 'data'), DIGITAL_BRAIN_VAULT_PATH: root, AVAILABLE: available },
    locale: 'en', chooseDirectory: async () => assert.fail('Keep selected vault'),
    launch: environment => launchBackend(childOptions(t, script, port, {
      environment, onSpawn: child => { children.push(child); },
    })),
    showRecoveryDialog: async () => {
      assert.equal(children.length, 1);
      assert.equal(children[0].exitCode, 74);
      fs.writeFileSync(available, 'ready');
      return { response: 0 };
    },
  });
  t.after(async () => { for (const child of children) await stopBackend(child, 100); });
  assert.equal(children.length, 2);
  assert.equal(await result.isRunning(), true);
  await result.stop();
  assert.equal(fs.existsSync(path.join(root, 'data', 'desktop-vault.json')), false);
});

test('private desktop port coexists with an occupied native listener', async t => {
  const occupied = await serverFixture(t, (_request, response) => response.end(body));
  const { selectBackendPort } = require('./backend-launch');
  const port = await selectBackendPort(Number(new URL(occupied).port));
  assert.notEqual(port, Number(new URL(occupied).port));
  const script = `require('http').createServer((req,res) => {
    res.setHeader('x-gnosi-desktop-instance', process.env.GNOSI_DESKTOP_INSTANCE);
    res.end(${JSON.stringify(body)});
  }).listen(Number(process.env.BACKEND_PORT), '127.0.0.1');`;
  const handle = await launchBackend(childOptions(t, script, port, {
    environment: { BACKEND_PORT: String(port) },
    // Real socket scheduling under native build load needs a realistic budget.
    startupTimeoutMs: 5000, requestTimeoutMs: 1000,
  }));
  assert.equal(await handle.isRunning(), true);
  await handle.stop();
  assert.equal((await fetch(occupied)).status, 200);
});

for (const configured of [false, true]) {
  test(`owned child readiness carries vault_configured=${configured} to native setup`, async t => {
    const port = await reservedPort();
    const payload = JSON.stringify({ status: 'ok', mode: 'FastAPI', vault_configured: configured });
    const script = `require('http').createServer((req,res) => {
      res.setHeader('x-gnosi-desktop-instance', process.env.GNOSI_DESKTOP_INSTANCE);
      res.end(${JSON.stringify(payload)});
    }).listen(${port},'127.0.0.1');`;
    const handle = await launchBackend(childOptions(t, script, port));
    assert.equal(handle.vaultConfigured, configured);
    await handle.stop();
  });
}

test('a foreign process cannot supply the Vault setup state', async t => {
  const url = await serverFixture(t, (_request, response) => {
    response.setHeader('x-gnosi-desktop-instance', 'a'.repeat(64));
    response.end(JSON.stringify({ status: 'ok', mode: 'FastAPI', vault_configured: false }));
  });
  let called = false;
  assert.equal(await probeBackend(url, identity, 500, undefined, () => { called = true; }), false);
  assert.equal(called, false);
});

for (const variant of ['valid', 'split', 'wrong-identity', 'wrong-exit', 'stdout', 'oversized']) {
  test(`cloud startup error requires an owned bounded stderr record and exit 74: ${variant}`, async t => {
    const script = `const marker = 'GNOSI_STARTUP_ERROR ' + ${variant === 'wrong-identity' ? "'f'.repeat(64)" : 'process.env.GNOSI_DESKTOP_INSTANCE'} + ' cloud_metadata_unavailable\\n';
      const output = process.${variant === 'stdout' ? 'stdout' : 'stderr'};
      ${variant === 'oversized' ? "output.write('x'.repeat(10000));" : ''}
      ${variant === 'split' ? "output.write(marker.slice(0, 20)); setTimeout(() => output.write(marker.slice(20)), 5);" : 'output.write(marker);'}
      setTimeout(() => process.exit(${variant === 'wrong-exit' ? 1 : 74}), 20);`;
    let child;
    await assert.rejects(launchBackend(childOptions(t, script, await reservedPort(), {
      onSpawn: process => { child = process; },
    })), error => {
      assert.equal(error.code === 'GNOSI_CLOUD_METADATA_UNAVAILABLE', ['valid', 'split'].includes(variant));
      return true;
    });
    assert.equal(child.exitCode, variant === 'wrong-exit' ? 1 : 74);
  });
}
