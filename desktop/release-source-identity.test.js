const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SCRIPT = path.join(__dirname, 'scripts/release-source-identity.cjs');
const updaterRequire = createRequire(require.resolve('electron-updater/package.json'));
const yaml = updaterRequire('js-yaml');
const workflow = yaml.load(fs.readFileSync(
  path.join(__dirname, '../.github/workflows/build-release.yml'), 'utf8',
));

function assertSourceIdentity(candidate) {
  const { steps } = candidate.jobs.preflight;
  const checkout = steps[0];
  const gateIndex = steps.findIndex((step) => step.name === 'Verify release source identity');
  const nodeIndex = steps.findIndex((step) => step.uses?.startsWith('actions/setup-node@'));
  assert.ok(nodeIndex > 0);
  assert.equal(steps[nodeIndex].with['node-version'], '22.22.2');
  assert.equal(gateIndex, nodeIndex + 1);
  const gate = steps[gateIndex];
  const beforeGate = steps.slice(0, gateIndex);
  assert.deepEqual(beforeGate.map((step) => step.name), ['Checkout', 'Setup pnpm', 'Setup Node.js']);
  assert.equal(steps.length, 4, 'preflight contains only checkout, pnpm, Node and source identity');
  assert.match(beforeGate[1].uses, /^pnpm\/action-setup@/);
  assert.equal(beforeGate[1].with.version, '11.19.0');
  assert.ok([undefined, false].includes(beforeGate[1].with.run_install),
    'pnpm setup must not install project dependencies before the guard');
  for (const step of beforeGate) {
    assert.equal(step.run, undefined, 'no dependency install, build or other command before the guard');
  }
  assert.match(checkout.uses, /^actions\/checkout@/);
  assert.equal(checkout.with.ref, '${{ github.sha }}');
  assert.equal(checkout.with['fetch-depth'], 0);
  assert.equal(checkout.with.submodules, 'recursive');
  assert.equal(gate.run, 'node desktop/scripts/release-source-identity.cjs');
  assert.deepEqual(gate.env, {
    RELEASE_EVENT: '${{ github.event_name }}',
    REQUESTED_TAG: '${{ inputs.tag }}',
    REF_TAG: '${{ github.ref_name }}',
    REF_TYPE: '${{ github.ref_type }}',
    EXPECTED_SHA: '${{ github.sha }}',
  });
  assert.equal(gate.if, undefined);
  assert.equal(gate['continue-on-error'], undefined);
  assert.equal(candidate.jobs.preflight['continue-on-error'], undefined);
  assert.equal(candidate.jobs.preflight.if, undefined);
  for (const step of steps) {
    assert.equal(step.if, undefined);
    assert.equal(step['continue-on-error'], undefined);
  }
  assert.doesNotMatch(gate.run, /\$\{\{/);
  for (const jobName of ['build-macos', 'build-linux', 'build-windows', 'release']) {
    const job = candidate.jobs[jobName];
    const checkouts = job.steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
    assert.equal(checkouts.length, 1, `${jobName} must have exactly one source checkout`);
    assert.equal(checkouts[0].with.ref, '${{ github.sha }}');
  }
}

test('preflight only verifies exact caller source before shared CI installs or builds', () => {
  assertSourceIdentity(workflow);
});

for (const [label, mutate] of [
  ['dispatch tag checkout', (candidate) => { candidate.jobs.preflight.steps[0].with.ref = '${{ inputs.tag }}'; }],
  ['branch checkout during collection', (candidate) => {
    candidate.jobs.release.steps.find((step) => step.uses?.startsWith('actions/checkout@')).with.ref = 'main';
  }],
  ['default platform checkout', (candidate) => {
    delete candidate.jobs['build-linux'].steps.find((step) => step.uses?.startsWith('actions/checkout@')).with.ref;
  }],
  ['shallow history', (candidate) => { candidate.jobs.preflight.steps[0].with['fetch-depth'] = 1; }],
  ['dependency installation', (candidate) => { candidate.jobs.preflight.steps[1].with.run_install = true; }],
  ['duplicated quality check', (candidate) => { candidate.jobs.preflight.steps.push({ run: 'pnpm test:desktop' }); }],
  ['tag instead of expected SHA', (candidate) => {
    candidate.jobs.preflight.steps[3].env.EXPECTED_SHA = '${{ inputs.tag }}';
  }],
  ['lost caller event', (candidate) => { candidate.jobs.preflight.steps[3].env.RELEASE_EVENT = 'workflow_call'; }],
  ['manual tag ignored', (candidate) => { candidate.jobs.preflight.steps[3].env.REQUESTED_TAG = '${{ github.ref_name }}'; }],
  ['tag push ignored', (candidate) => { candidate.jobs.preflight.steps[3].env.REF_TAG = '${{ inputs.tag }}'; }],
]) {
  test(`source identity contract rejects ${label}`, () => {
    assertSourceIdentity(workflow);
    const candidate = structuredClone(workflow);
    mutate(candidate);
    assert.throws(() => assertSourceIdentity(candidate), assert.AssertionError);
  });
}

function fixture(t, objectFormat = 'sha1', version = '3.0.0') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-source-identity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = {
    PATH: process.env.PATH,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_ALLOW_PROTOCOL: '',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Synthetic Release Fixture',
    GIT_AUTHOR_EMAIL: 'release@example.invalid',
    GIT_COMMITTER_NAME: 'Synthetic Release Fixture',
    GIT_COMMITTER_EMAIL: 'release@example.invalid',
    GIT_AUTHOR_DATE: '2026-08-31T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-08-31T00:00:00Z',
  };
  const git = (args, input) => {
    const result = spawnSync('git', args, {
      cwd: root, env, input, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(['init', '--quiet', '--template=', `--object-format=${objectFormat}`]);
  const tree = git(['mktree'], '');
  const first = git(['commit-tree', tree, '-m', 'Synthetic first commit']);
  const second = git(['commit-tree', tree, '-p', first, '-m', 'Synthetic second commit']);
  git(['update-ref', 'HEAD', first]);
  const writeVersion = (relative, nextVersion) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (relative === 'pyproject.toml') {
      fs.writeFileSync(target, `[project]\nname = "fixture"\nversion = "${nextVersion}"\n`);
    } else {
      fs.writeFileSync(target, `${JSON.stringify({
        name: 'fixture', version: nextVersion, license: 'AGPL-3.0-or-later',
      })}\n`);
    }
  };
  for (const relative of ['package.json', 'frontend/package.json', 'desktop/package.json', 'pyproject.toml']) {
    writeVersion(relative, version);
  }
  const tag = (name = 'v3.0.0', target = first, annotated = false) => {
    git(['-c', 'tag.gpgSign=false', 'tag', ...(annotated ? ['-a', '-m', 'Synthetic tag'] : []),
      name, target]);
  };
  const probe = (overrides = {}) => {
    const before = git(['show-ref', '--head']);
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: root,
      env: {
        ...env, RELEASE_EVENT: 'workflow_dispatch', REQUESTED_TAG: 'v3.0.0',
        REF_TAG: 'main', REF_TYPE: 'branch', EXPECTED_SHA: first, ...overrides,
      },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(git(['show-ref', '--head']), before, 'verifier must not change refs or HEAD');
    assert.equal(fs.existsSync(path.join(root, 'injected')), false);
    return result;
  };
  return { git, tag, probe, first, second, tree, root, writeVersion };
}

function reject(result, message) {
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, message);
}

for (const event of ['push', 'workflow_dispatch']) {
  for (const annotated of [false, true]) {
    test(`accepts ${event} ${annotated ? 'annotated' : 'lightweight'} tag at exact source`, (t) => {
      const f = fixture(t);
      const tag = 'v3.0.0-rc.1+build.5';
      f.writeVersion('package.json', tag.slice(1));
      f.writeVersion('frontend/package.json', tag.slice(1));
      f.writeVersion('desktop/package.json', tag.slice(1));
      f.writeVersion('pyproject.toml', tag.slice(1));
      f.tag(tag, f.first, annotated);
      const result = f.probe({
        RELEASE_EVENT: event, REF_TYPE: event === 'push' ? 'tag' : 'branch',
        REF_TAG: event === 'push' ? tag : 'ignored',
        REQUESTED_TAG: event === 'push' ? '$(touch injected)' : tag,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, `Verified release source ${tag} at ${f.first}.\n`);
    });
  }
}

for (const relative of ['package.json', 'frontend/package.json', 'desktop/package.json', 'pyproject.toml']) {
  test(`rejects a release tag that differs from ${relative}`, (t) => {
    const f = fixture(t);
    f.tag();
    f.writeVersion(relative, '3.0.1');
    reject(f.probe(), new RegExp(`does not match ${relative.replace('.', '\\.')}`));
  });
}

for (const relative of ['package.json', 'frontend/package.json', 'desktop/package.json']) {
  test(`rejects a release manifest with a divergent license in ${relative}`, (t) => {
    const f = fixture(t);
    f.tag();
    fs.writeFileSync(path.join(f.root, relative), `${JSON.stringify({
      name: 'fixture', version: '3.0.0', license: 'MIT',
    })}\n`);
    reject(f.probe(), new RegExp(`${relative.replace('.', '\\.')} must declare AGPL`));
  });
}

for (const tag of [
  '', 'main', '--help', 'refs/tags/v3.0.0', 'v3.0.0^{commit}', 'v3.0.0~1',
  'v3.0.0;touch injected', 'v3.0.0$(touch injected)', 'v3.0.0`touch injected`',
  'v3.0.0\n', 'v3.0.0\r', 'v3.0.0\nother=bad', 'v3.0.0 rc1',
  'v3.0.0-..rc', 'v3.0.0-rc.', 'v3.0.0-rc.lock',
]) {
  test(`rejects invalid release ref ${JSON.stringify(tag)}`, (t) => {
    const f = fixture(t);
    reject(f.probe({ REQUESTED_TAG: tag }), /Invalid release tag/);
  });
}

test('requires exact existing tag, not a similarly named branch or current HEAD', (t) => {
  const f = fixture(t);
  f.git(['update-ref', 'refs/heads/v3.0.0', f.first]);
  f.tag('v3.0.0-other');
  reject(f.probe(), /Release tag is missing.*fetch.*tag refs/i);
});

for (const annotated of [false, true]) {
  for (const event of ['push', 'workflow_dispatch']) {
    test(`rejects ${event} wrong commit behind ${annotated ? 'annotated' : 'lightweight'} tag`, (t) => {
      const f = fixture(t);
      f.tag('v3.0.0', f.second, annotated);
      reject(f.probe({ RELEASE_EVENT: event, REF_TYPE: 'tag', REF_TAG: 'v3.0.0' }),
        /Release tag does not match EXPECTED_SHA/);
    });
  }
  for (const kind of ['blob', 'tree']) {
    test(`rejects ${annotated ? 'annotated' : 'lightweight'} tag targeting ${kind}`, (t) => {
      const f = fixture(t);
      const target = kind === 'tree' ? f.tree : f.git(['hash-object', '-w', '--stdin'], 'synthetic');
      f.tag('v3.0.0', target, annotated);
      reject(f.probe(), /Release tag does not resolve to a commit/);
    });
  }
}

for (const event of ['push', 'workflow_dispatch']) {
  test(`rejects ${event} checkout at another commit without changing source`, (t) => {
    const f = fixture(t);
    f.tag();
    f.git(['update-ref', 'HEAD', f.second]);
    reject(f.probe({ RELEASE_EVENT: event, REF_TYPE: 'tag', REF_TAG: 'v3.0.0' }),
      /Checked-out HEAD does not match EXPECTED_SHA/);
  });
}

for (const sha of ['', 'HEAD', '--help', 'a'.repeat(39), 'b'.repeat(41), 'a'.repeat(40) + '\n']) {
  test(`rejects malformed expected SHA ${JSON.stringify(sha)}`, (t) => {
    const f = fixture(t);
    f.tag();
    reject(f.probe({ EXPECTED_SHA: sha }), /EXPECTED_SHA must be a full/);
  });
}

test('requires expected SHA itself to name an existing commit, not an annotated tag object', (t) => {
  const f = fixture(t);
  f.tag('v3.0.0', f.first, true);
  reject(f.probe({ EXPECTED_SHA: f.git(['rev-parse', 'refs/tags/v3.0.0']) }),
    /EXPECTED_SHA does not name a commit/);
  reject(f.probe({ EXPECTED_SHA: 'a'.repeat(40) }), /EXPECTED_SHA does not name a commit/);
});

test('rejects unsupported events and branch pushes without dispatch fallback', (t) => {
  const f = fixture(t);
  f.tag();
  reject(f.probe({ RELEASE_EVENT: 'pull_request' }), /Unsupported release event/);
  reject(f.probe({ RELEASE_EVENT: '' }), /Unsupported release event/);
  reject(f.probe({ RELEASE_EVENT: 'push', REF_TAG: 'v3.0.0' }), /Push must refer to a tag/);
  reject(f.probe({ RELEASE_EVENT: 'push', REF_TYPE: 'tag', REF_TAG: 'v3.0.0$(touch injected)' }),
    /Invalid release tag/);
});

test('supports SHA-256 repository identities without accepting abbreviated hashes', (t) => {
  const f = fixture(t, 'sha256');
  f.tag('v3.0.0', f.first, true);
  assert.equal(f.first.length, 64);
  const result = f.probe();
  assert.equal(result.status, 0, result.stderr);
  reject(f.probe({ EXPECTED_SHA: f.first.slice(0, 12) }), /EXPECTED_SHA must be a full/);
});
