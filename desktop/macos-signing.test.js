const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { checkSigning, validateEnvironment } = require('./scripts/macos-signing-preflight.cjs');
const { signRelease } = require('./scripts/sign-macos-release.cjs');
const { validateSignature, verifyRelease } = require('./scripts/verify-macos-release.cjs');
const config = require('./electron-builder.macos-release.cjs');
const team = 'ABCDEFGHIJ';
const environment = { APPLE_TEAM_ID: team, APPLE_KEYCHAIN_PROFILE: 'gnosi-notary' };
const signature = `Authority=Developer ID Application: Gnosi (${team})\nTeamIdentifier=${team}\nTimestamp=Sep 8, 2026 at 12:00:00\nCodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=10+7 location=embedded`;

test('distribution prerequisites reject missing credentials and development-only identities', () => {
  assert.throws(() => validateEnvironment({}), /APPLE_TEAM_ID/);
  assert.throws(() => validateEnvironment({ APPLE_TEAM_ID: team }), /notarization/);
  assert.throws(() => validateEnvironment({ ...environment, APPLE_ID: 'incomplete' }), /both/);
  assert.throws(() => validateEnvironment({ ...environment, APPLE_API_KEY_ID: 'incomplete' }), /all/);
  assert.throws(() => validateEnvironment({ ...environment, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }), /discovery/);
  assert.throws(() => checkSigning({ environment, platform: 'darwin', run: () => '1) ABC "Apple Development: Example"' }), /Developer ID Application/);
  assert.throws(() => checkSigning({ environment, platform: 'linux' }), /macOS/);
});

test('a usable local Developer ID identity and Keychain profile pass without exporting credentials', () => {
  const calls = [];
  checkSigning({ environment, platform: 'darwin', run: (tool, args) => {
    calls.push([tool, args]);
    return `1) HASH "Developer ID Application: Gnosi (${team})"\n1 valid identities found`;
  } });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2], ['/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']]);
});

test('CI P12 credentials are imported by the builder, not exported by the preflight', () => {
  checkSigning({ environment: { ...environment, CSC_LINK: '/fixture/certificate.p12' }, platform: 'darwin', run: tool => {
    assert.equal(tool, '/usr/bin/xcrun');
  } });
});

test('merged release configuration requires signing and notarization with full native-code coverage', async () => {
  const { createRequire } = require('node:module');
  const fromBuilder = createRequire(require.resolve('electron-builder/package.json'));
  const { getConfig, validateConfiguration } = fromBuilder('app-builder-lib/out/util/config/config');
  const merged = await getConfig(__dirname, 'electron-builder.macos-release.cjs');
  await validateConfiguration(merged);
  assert.equal(merged.forceCodeSigning, true);
  assert.equal(merged.mac.notarize, true);
  assert.equal(merged.mac.hardenedRuntime, true);
  assert.equal(merged.mac.signIgnore, null);
  assert.equal(merged.mac.sign, config.mac.sign);
  assert.equal(merged.dmg.sign, true);
  assert.deepEqual(merged.mac.target, [{ target: 'dmg' }, { target: 'zip' }]);
});

test('the custom signer signs Python, extensions and helpers before sealing the app', () => {
  const app = '/fixture/with spaces/Gnosi.app';
  const backend = path.join(app, 'Contents/Resources/python/cervell_backend');
  const addon = path.join(app, 'Contents/Resources/python/_internal/example.so');
  const helper = path.join(app, 'Contents/Frameworks/Gnosi Helper.app');
  const calls = [];
  signRelease({ app, identity: 'fixture-hash', type: 'distribution', platform: 'darwin', keychain: '/fixture/keychain' }, {
    collect: () => ({ files: [backend, addon], directories: [app, helper] }),
    run: (tool, args) => calls.push([tool, args]),
  });
  const signed = calls.filter(([, args]) => args.includes('--sign'));
  assert.deepEqual(signed.map(([, args]) => args.at(-1)), [addon, backend, helper, app]);
  for (const [tool, args] of signed) {
    assert.equal(tool, '/usr/bin/codesign');
    assert.ok(args.includes('--timestamp'));
    assert.ok(args.includes('runtime'));
    assert.ok(args.includes('/fixture/keychain'));
    assert.ok(!args.includes('--deep'));
  }
  assert.ok(signed.find(([, args]) => args.at(-1) === backend)[1].includes('--entitlements'));
  assert.equal(calls.at(-1)[1][0], '--verify');
  assert.throws(() => signRelease({ app, identity: '-', type: 'distribution', platform: 'darwin' }), /distribution/);
});

test('the packaged release must retain the expected team, timestamp and runtime flags', () => {
  validateSignature(signature, team);
  for (const details of [signature.replace(team, 'XXXXXXXXXX').replace(`TeamIdentifier=${team}`, 'TeamIdentifier=XXXXXXXXXX'),
    signature.replace('Timestamp=', 'NoTimestamp='), signature.replace('runtime', 'adhoc'), 'Signature=adhoc']) {
    assert.throws(() => validateSignature(details, team), /Developer ID/);
  }
});

test('final verification requires an Apple ticket and Gatekeeper acceptance', () => {
  const calls = [];
  const context = { electronPlatformName: 'darwin', appOutDir: '/fixture', packager: { appInfo: { productFilename: 'Gnosi' } } };
  const dependencies = { environment, collect: () => ({ files: ['/fixture/Gnosi.app/Contents/Resources/python/cervell_backend'], directories: [] }),
    spawn: () => ({ status: 0, stderr: signature }), run: (tool, args) => calls.push([tool, args]),
  };
  verifyRelease(context, dependencies);
  assert.deepEqual(calls.at(-2), ['/usr/bin/xcrun', ['stapler', 'validate', '/fixture/Gnosi.app']]);
  assert.equal(calls.at(-1)[0], '/usr/sbin/spctl');
  assert.throws(() => verifyRelease(context, { ...dependencies, run: tool => { if (tool === '/usr/bin/xcrun') throw new Error('No ticket'); } }), /No ticket/);
});

test('the installed electron-builder resolves every distribution hook as a function', async () => {
  const { createRequire } = require('node:module');
  const fromBuilder = createRequire(require.resolve('electron-builder/package.json'));
  const { resolveFunction } = fromBuilder('app-builder-lib/out/util/resolve');
  for (const [name, hook] of [['beforePack', config.beforePack], ['afterSign', config.afterSign], ['sign', config.mac.sign]]) {
    const resolved = await resolveFunction(undefined, path.resolve(__dirname, hook), name, path.dirname(__dirname));
    assert.equal(typeof resolved, 'function', name);
  }
});
