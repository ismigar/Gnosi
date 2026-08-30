const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const nodeTest = require('node:test');

// build.sh is a POSIX entry point; Windows packaging uses its native commands.
const test = process.platform === 'win32' ? nodeTest.skip : nodeTest;

const INSTALL_ARGS = ['install', '--frozen-lockfile'];
const BUILD_ARGS = ['--filter', '@gnosi/desktop', 'build'];

function createFixture(t, { dist = 'directory', siblingDist = false } = {}) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'gnosi-build-script-'),
  );
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  const repoRoot = path.join(temporaryRoot, 'repo with spaces');
  const desktop = path.join(repoRoot, 'desktop');
  const externalCwd = path.join(temporaryRoot, 'external working directory');
  const bin = path.join(temporaryRoot, 'command doubles');
  const log = path.join(temporaryRoot, 'pnpm calls.log');
  const script = path.join(desktop, 'build.sh');

  for (const directory of [desktop, externalCwd, bin]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.copyFileSync(path.join(__dirname, 'build.sh'), script);
  fs.writeFileSync(log, '');

  const frontendDist = path.join(repoRoot, 'frontend', 'dist');
  if (dist === 'directory') {
    fs.mkdirSync(frontendDist, { recursive: true });
  } else if (dist === 'file') {
    fs.mkdirSync(path.dirname(frontendDist), { recursive: true });
    fs.writeFileSync(frontendDist, 'not a build directory');
  }
  if (siblingDist) {
    fs.mkdirSync(path.join(temporaryRoot, 'frontend', 'dist'), {
      recursive: true,
    });
  }

  // A closed PATH prevents any real package manager or build tool from running.
  fs.symlinkSync('/usr/bin/dirname', path.join(bin, 'dirname'));
  fs.writeFileSync(
    path.join(bin, 'pnpm'),
    `#!/bin/bash
set -e
printf '%s\\n' "$PWD" "$#" "$@" >> "$GNOSI_BUILD_TEST_LOG"
if [ "$#" -eq 2 ] && [ "$1" = install ] && [ "$2" = --frozen-lockfile ]; then
    exit "$GNOSI_BUILD_TEST_INSTALL_STATUS"
fi
if [ "$#" -eq 3 ] && [ "$1" = --filter ] && [ "$2" = @gnosi/desktop ] && [ "$3" = build ]; then
    exit "$GNOSI_BUILD_TEST_BUILD_STATUS"
fi
echo "Unexpected pnpm command" >&2
exit 99
`,
    { mode: 0o755 },
  );

  return {
    repoRoot,
    desktop,
    externalCwd,
    run({ cwd = externalCwd, relative = false, installStatus = 0, buildStatus = 0 } = {}) {
      const result = spawnSync(
        '/bin/bash',
        [relative ? path.relative(cwd, script) : script],
        {
          cwd,
          encoding: 'utf8',
          timeout: 5000,
          env: {
            PATH: bin,
            GNOSI_BUILD_TEST_LOG: log,
            GNOSI_BUILD_TEST_INSTALL_STATUS: String(installStatus),
            GNOSI_BUILD_TEST_BUILD_STATUS: String(buildStatus),
          },
        },
      );
      assert.ifError(result.error);
      assert.equal(result.signal, null);

      const lines = fs.readFileSync(log, 'utf8').trimEnd().split('\n');
      const calls = [];
      for (let index = 0; index < lines.length && lines[index];) {
        const callCwd = lines[index++];
        const count = Number(lines[index++]);
        assert.ok(Number.isInteger(count) && count > 0, 'valid pnpm argument count');
        calls.push({ cwd: callCwd, args: lines.slice(index, index + count) });
        index += count;
      }
      return { ...result, calls };
    },
  };
}

function expectedCalls(repoRoot, includeBuild = true) {
  return [
    { cwd: repoRoot, args: INSTALL_ARGS },
    ...(includeBuild ? [{ cwd: repoRoot, args: BUILD_ARGS }] : []),
  ];
}

for (const caller of ['external', 'root', 'desktop']) {
  test(`build succeeds from ${caller} cwd with spaces in paths`, (t) => {
    const fixture = createFixture(t);
    const cwd = {
      external: fixture.externalCwd,
      root: fixture.repoRoot,
      desktop: fixture.desktop,
    }[caller];
    const result = fixture.run({ cwd, relative: caller !== 'external' });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(result.calls, expectedCalls(fixture.repoRoot));
    assert.match(result.stdout, /Frontend dist found\./);
    assert.match(result.stdout, /=== Build complete! ===/);
    assert.ok(result.stdout.includes(`Output files are in: ${fixture.desktop}/dist/`));
  });
}

test('relative script path resolves correctly from an external cwd', (t) => {
  const fixture = createFixture(t);
  const result = fixture.run({ relative: true });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(result.calls, expectedCalls(fixture.repoRoot));
});

for (const siblingDist of [false, true]) {
  test(`missing repository dist fails with sibling dist ${siblingDist ? 'present' : 'absent'}`, (t) => {
    const fixture = createFixture(t, { dist: 'missing', siblingDist });
    const result = fixture.run();

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.deepEqual(result.calls, expectedCalls(fixture.repoRoot, false));
    assert.match(result.stdout, /Frontend not built\. Run 'pnpm build:frontend'/);
    assert.doesNotMatch(result.stdout, /Frontend dist found|Running electron-builder|Build complete/);
  });
}

test('a regular file at frontend/dist is not accepted as build output', (t) => {
  const fixture = createFixture(t, { dist: 'file' });
  const result = fixture.run();

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.deepEqual(result.calls, expectedCalls(fixture.repoRoot, false));
  assert.match(result.stdout, /Frontend not built/);
});

test('frozen install failure propagates and prevents the remaining steps', (t) => {
  const fixture = createFixture(t);
  const result = fixture.run({ installStatus: 23 });

  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.deepEqual(result.calls, expectedCalls(fixture.repoRoot, false));
  assert.doesNotMatch(result.stdout, /Frontend dist found|Running electron-builder|Build complete/);
});

test('desktop workspace build failure propagates without reporting success', (t) => {
  const fixture = createFixture(t);
  const result = fixture.run({ buildStatus: 42 });

  assert.equal(result.status, 42, result.stderr || result.stdout);
  assert.deepEqual(result.calls, expectedCalls(fixture.repoRoot));
  assert.match(result.stdout, /Running electron-builder/);
  assert.doesNotMatch(result.stdout, /Build complete|Output files are in/);
});
