const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { verifyPackagedBackendResources, getResourcesDirectory } = require('./scripts/packaging-contract.cjs');

for (const platform of ['darwin', 'linux', 'win32']) {
  const context = { electronPlatformName: platform, appOutDir: '/fixture/path with spaces $literal',
    packager: { appInfo: { productFilename: 'Gnosi' } } };

  test(`${platform} validates the actual copied backend with separate arguments`, () => {
    const calls = [];
    verifyPackagedBackendResources(context, (...args) => calls.push(args), '/fixture/python with spaces');
    assert.equal(calls.length, 1);
    const [executable, args, options] = calls[0];
    assert.equal(executable, '/fixture/python with spaces');
    assert.deepEqual(args, [path.join(__dirname, 'scripts/backend_resources.py'), 'verify',
      '--repository', path.dirname(__dirname), '--bundle', path.join(getResourcesDirectory(context), 'python')]);
    assert.equal(options.shell, undefined);
    assert.equal(options.cwd, path.dirname(__dirname));
    assert.equal(options.timeout, 120000);
    const failure = new Error('Synthetic prohibited resource');
    assert.throws(() => verifyPackagedBackendResources(context, () => { throw failure; }), error => error === failure);
  });

  for (const boundary of ['archive', 'backend']) {
    test(`${platform} actual afterPack rejects ${boundary} failure before signing`, async () => {
      const calls = [];
      const failure = new Error(`Synthetic ${boundary} failure`);
      const exported = {};
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'scripts/after-pack.cjs'), 'utf8'), {
        exports: exported,
        require(name) {
          if (name === 'node:path') return path;
          if (name === 'node:fs') return new Proxy({}, { get() { assert.fail('Must not read/sign app on validation failure'); } });
          if (name === 'node:child_process') return { execFileSync: () => assert.fail('Must not sign invalid packages') };
          assert.equal(name, './packaging-contract.cjs');
          return {
            verifyPackagedRuntime(actual) {
              assert.equal(actual, context);
              calls.push('archive');
              if (boundary === 'archive') throw failure;
            },
            verifyPackagedBackendResources(actual) {
              assert.equal(actual, context);
              calls.push('backend');
              if (boundary === 'backend') throw failure;
            },
          };
        },
      }, { filename: 'after-pack.cjs' });
      await assert.rejects(exported.default(context), error => error === failure);
      assert.deepEqual(calls, boundary === 'archive' ? ['archive'] : ['archive', 'backend']);
    });
  }
}
