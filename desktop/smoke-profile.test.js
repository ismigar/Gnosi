const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = path.join(__dirname, 'scripts', 'smoke-profile.cjs');
const source = fs.readFileSync(script, 'utf8');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gnosi-smoke-selection-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, 'node_modules', 'electron');
  const calls = [];
  const requires = [];
  const resolutions = [];
  const asarCalls = [];
  let stdout = '';
  let stderr = '';

  function file(relative, content = 'inert executable fixture') {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
    return filename;
  }

  function installMetadata(executable = 'Electron.app/Contents/MacOS/Electron') {
    file('node_modules/electron/package.json', JSON.stringify({ name: 'electron', main: 'index.js' }));
    // Neither executable package code nor installer code may ever be loaded.
    file('node_modules/electron/index.js', "throw new Error('FORBIDDEN Electron package entry');");
    file('node_modules/electron/install.js', "throw new Error('FORBIDDEN Electron installer');");
    file('node_modules/electron/path.txt', `${executable}\n`);
    return file(path.join('node_modules', 'electron', 'dist', executable));
  }

  function run(args = [], { env = {}, failedStage, status = 19, spawnError, passed = true, createAsar } = {}) {
    const fixtureRequire = createRequire(path.join(root, 'runner.cjs'));
    const doubles = {
      'node:assert/strict': assert,
      'node:fs': fs,
      'node:os': { tmpdir: () => root },
      'node:path': path,
      './profile-asar.cjs': {
        createProfileAsar(smokeRoot) {
          asarCalls.push(smokeRoot);
          assert.equal(path.dirname(smokeRoot), root, 'ASAR uses the owned temporary root');
          assert.equal(fs.readFileSync(path.join(smokeRoot, 'owned-fixture'), 'utf8'), 'Gnosi synthetic profile smoke v1');
          if (createAsar) return createAsar(smokeRoot);
          return Promise.resolve().then(() => file(path.relative(root, path.join(smokeRoot, 'app.asar'))));
        },
      },
      'node:child_process': {
        spawnSync(runtime, argv, options) {
          const stage = options.env.GNOSI_PROFILE_SMOKE_STAGE;
          assert.ok(['seed', 'upgrade', 'repeat'].includes(stage), 'only smoke stages may spawn');
          assert.equal(argv.length, 1, 'no installer or shell arguments');
          calls.push({ runtime, argv, options });
          if (stage === failedStage) return { status, error: spawnError, stderr: 'synthetic failure' };
          file(path.relative(root, path.join(options.env.GNOSI_PROFILE_SMOKE_DIR, `${stage}.json`)),
            JSON.stringify({ passed, electron: `fixture-${stage}` }));
          return { status: 0, stderr: '' };
        },
      },
    };
    const safeRequire = name => {
      requires.push(name);
      assert.ok(Object.hasOwn(doubles, name), `forbidden module execution: ${name}`);
      return doubles[name];
    };
    safeRequire.resolve = name => {
      resolutions.push(name);
      assert.equal(name, 'electron/package.json', 'resolve metadata only');
      // No fallback to the real workspace package when the fixture is absent.
      assert.ok(fs.existsSync(path.join(packageRoot, 'package.json')), 'fixture package missing');
      return fixtureRequire.resolve(name);
    };
    return vm.runInNewContext(source, {
      require: safeRequire,
      __dirname: path.dirname(script),
      process: {
        argv: [process.execPath, script, ...args],
        env,
        stdout: { write: value => { stdout += value; } },
        stderr: { write: value => { stderr += value; } },
      },
    }, { filename: script, timeout: 2000 });
  }

  return { root, packageRoot, file, installMetadata, run, calls, requires, resolutions, asarCalls,
    get stdout() { return stdout; }, get stderr() { return stderr; } };
}

function assertStages(value, seed, target, archive) {
  assert.deepEqual(value.calls.map(call => call.runtime), [seed, target, target]);
  assert.deepEqual(value.calls.map(call => call.options.env.GNOSI_PROFILE_SMOKE_STAGE), ['seed', 'upgrade', 'repeat']);
  const smokeRoot = value.calls[0].options.env.GNOSI_PROFILE_SMOKE_DIR;
  for (const [index, call] of value.calls.entries()) {
    assert.equal(call.options.env.GNOSI_PROFILE_SMOKE_DIR, smokeRoot);
    assert.equal(call.options.timeout, 45_000);
    assert.equal(call.options.maxBuffer, 1024 * 1024);
    assert.equal(call.options.encoding, 'utf8');
    if (archive && index > 0) {
      assert.equal(call.argv[0], archive);
      assert.ok(fs.statSync(archive).isFile());
      continue;
    }
    assert.equal(call.argv[0], path.join(smokeRoot, index === 0 ? 'legacy-app' : 'current-app'));
    const app = JSON.parse(fs.readFileSync(path.join(call.argv[0], 'package.json'), 'utf8'));
    assert.equal(app.name, index === 0 ? 'gnosi' : '@gnosi/desktop');
    assert.equal(app.version, '2.0.6');
    assert.equal(app.main, path.join(path.dirname(script), 'profile-probe.cjs'));
  }
  const report = JSON.parse(fs.readFileSync(path.join(smokeRoot, 'report.json'), 'utf8'));
  assert.equal(report.passed, true);
  assert.equal(report.reports.length, 3);
  assert.match(value.stdout, /Profile smoke passed/);
  assert.ok(value.requires.every(name => name.startsWith('node:') || (archive && name === './profile-asar.cjs')));
  assert.deepEqual(value.asarCalls, archive ? [smokeRoot] : []);
}

for (const packagePresent of [false, true]) {
  test(`explicit runtimes bypass package resolution (package present: ${packagePresent})`, async t => {
    const value = fixture(t);
    if (packagePresent) value.installMetadata();
    const seed = value.file('old runtime/Electron');
    const target = value.file('new runtime/Electron');
    await value.run([seed, target]);
    assertStages(value, seed, target);
    assert.deepEqual(value.resolutions, []);
  });
}

for (const selection of ['both defaults', 'explicit seed', 'explicit target']) {
  test(`local metadata selects runtimes with ${selection}`, async t => {
    const value = fixture(t);
    const installed = value.installMetadata();
    const explicit = value.file('provided runtime/Electron');
    const args = selection === 'explicit seed' ? [explicit] : selection === 'explicit target' ? ['', explicit] : [];
    await value.run(args);
    assertStages(value, args[0] || installed, args[1] || installed);
    assert.deepEqual(value.resolutions, ['electron/package.json']);
  });
}

for (const failure of ['package missing', 'path missing', 'path empty', 'binary missing', 'binary directory', 'path escapes']) {
  test(`${failure} fails before spawning and gives explicit installation guidance`, async t => {
    const value = fixture(t);
    if (failure !== 'package missing') {
      const binary = value.installMetadata();
      const pathFile = path.join(value.packageRoot, 'path.txt');
      if (failure === 'path missing') fs.unlinkSync(pathFile);
      if (failure === 'path empty') fs.writeFileSync(pathFile, ' \n');
      if (failure === 'binary missing' || failure === 'binary directory') fs.unlinkSync(binary);
      if (failure === 'binary directory') fs.mkdirSync(binary);
      if (failure === 'path escapes') fs.writeFileSync(pathFile, '../index.js');
    }
    await assert.rejects(value.run(), /install:runtime.*absolute seed and target.*No runtime was downloaded/);
    assert.deepEqual(value.calls, []);
    assert.equal(value.stdout, '');
    assert.equal(fs.readdirSync(value.root).some(name => name.startsWith('gnosi-profile-smoke-')), false);
  });
}

for (const pathMetadata of [true, false]) {
  test(`installed override directory remains supported (path metadata: ${pathMetadata})`, async t => {
    const value = fixture(t);
    value.installMetadata('electron');
    if (!pathMetadata) fs.unlinkSync(path.join(value.packageRoot, 'path.txt'));
    const runtime = value.file('override runtime/electron');
    await value.run([], { env: { ELECTRON_OVERRIDE_DIST_PATH: path.dirname(runtime) } });
    assertStages(value, runtime, runtime);
  });
}

test('invalid explicit executable fails without resolving Electron or spawning', async t => {
  const value = fixture(t);
  await assert.rejects(value.run(['relative/Electron', value.file('target')]), /absolute Electron executable/);
  assert.deepEqual(value.resolutions, []);
  assert.deepEqual(value.calls, []);
});

for (const failedStage of ['seed', 'upgrade', 'repeat']) {
  test(`failure at ${failedStage} stops subsequent stages`, async t => {
    const value = fixture(t);
    const runtime = value.file('explicit runtime');
    await assert.rejects(value.run([runtime, runtime], { failedStage }), new RegExp(`Electron ${failedStage} exited 19`));
    assert.equal(value.calls.length, ['seed', 'upgrade', 'repeat'].indexOf(failedStage) + 1);
    assert.match(value.stderr, new RegExp(`Profile smoke failed at ${failedStage}`));
    assert.doesNotMatch(value.stdout, /Profile smoke passed/);
  });
}

test('spawn errors and failed reports cannot produce aggregate success', async t => {
  const value = fixture(t);
  const runtime = value.file('explicit runtime');
  const spawnError = new Error('synthetic spawn error');
  await assert.rejects(value.run([runtime, runtime], { failedStage: 'seed', spawnError }), error => error === spawnError);
  await assert.rejects(value.run([runtime, runtime], { passed: false }), /false !== true/);
  assert.equal(value.calls.length, 2);
  assert.doesNotMatch(value.stdout, /Profile smoke passed/);
});

test('--asar awaits creation in the owned root and uses the archive only for target stages', async t => {
  const value = fixture(t);
  const seed = value.file('old runtime/Electron');
  const target = value.file('target runtime/Electron');
  let finishCreation;
  const gate = new Promise(resolve => { finishCreation = resolve; });
  let archive;
  const completion = value.run([seed, target, '--asar'], {
    createAsar: smokeRoot => gate.then(() => {
      archive = value.file(path.relative(value.root, path.join(smokeRoot, 'app.asar')));
      return archive;
    }),
  });
  assert.equal(typeof completion.then, 'function', 'runner exposes its completion promise');
  assert.equal(value.asarCalls.length, 1);
  assert.deepEqual(value.calls, [], 'no stage starts while ASAR creation is pending');
  finishCreation();
  await completion;
  assertStages(value, seed, target, archive);
  assert.deepEqual(value.resolutions, []);
  assert.equal(value.requires.filter(name => name === './profile-asar.cjs').length, 1);
});

for (const asynchronous of [false, true]) {
  test(`ASAR creation failure stops before target stages (asynchronous: ${asynchronous})`, async t => {
    const value = fixture(t);
    const runtime = value.file('explicit runtime');
    const failure = new Error('synthetic ASAR creation failure');
    await assert.rejects(value.run([runtime, runtime, '--asar'], {
      createAsar: () => {
        if (asynchronous) return Promise.reject(failure);
        throw failure;
      },
    }), error => error === failure);
    assert.equal(value.asarCalls.length, 1);
    assert.deepEqual(value.calls, []);
    assert.deepEqual(value.resolutions, []);
    assert.equal(fs.existsSync(path.join(value.asarCalls[0], 'report.json')), false);
    assert.doesNotMatch(value.stdout, /Profile smoke passed/);
  });
}

test('invalid explicit runtime prevents loading the optional ASAR helper', async t => {
  const value = fixture(t);
  await assert.rejects(value.run(['relative/Electron', value.file('target'), '--asar']), /absolute Electron executable/);
  assert.deepEqual(value.asarCalls, []);
  assert.deepEqual(value.resolutions, []);
  assert.deepEqual(value.calls, []);
  assert.equal(value.requires.includes('./profile-asar.cjs'), false);
});

for (const args of [
  ['--unknown'],
  ['--asar'],
  ['seed', '--asar'],
  ['seed', 'target', '--unknown'],
  ['seed', 'target', 'extra'],
  ['seed', 'target', '--asar', 'extra'],
  ['seed', 'target', '--asar', '--asar'],
]) {
  test(`rejects invalid arguments before runtime resolution: ${args.join(' ')}`, async t => {
    const value = fixture(t);
    await assert.rejects(value.run(args), /Unknown or extra arguments.*Usage:/);
    assert.deepEqual(value.resolutions, []);
    assert.deepEqual(value.asarCalls, []);
    assert.deepEqual(value.calls, []);
    assert.deepEqual(fs.readdirSync(value.root), []);
    assert.equal(value.stdout, '');
  });
}
