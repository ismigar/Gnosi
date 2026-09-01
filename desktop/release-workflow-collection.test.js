const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const updaterRequire = createRequire(require.resolve('electron-updater/package.json'));
const yaml = updaterRequire('js-yaml');
const workflow = yaml.load(fs.readFileSync(
  path.join(__dirname, '../.github/workflows/build-release.yml'), 'utf8',
));
const steps = workflow.jobs.release.steps;
const find = (name) => {
  const index = steps.findIndex((step) => step.name === name);
  assert.notEqual(index, -1, `Missing required step: ${name}`);
  return { index, step: steps[index] };
};

test('release prepares locked collector dependencies without running install scripts', () => {
  const pnpm = find('Setup pnpm');
  const node = find('Setup Node.js');
  const install = find('Prepare locked artifact collector dependencies');
  const collect = find('Validate and collect release artifacts');
  assert.equal(pnpm.step.with.version, '11.19.0');
  assert.equal(node.step.with['node-version'], '22.22.2');
  assert.equal(install.step.run,
    'pnpm --filter @gnosi/desktop install --prod --frozen-lockfile --ignore-scripts');
  assert.ok(pnpm.index < node.index && node.index < install.index && install.index < collect.index);
});

const GROUPS = ['macos-arm64', 'macos-x64', 'linux-arm64', 'windows-x64'];

function assertArchitectureDownloads(releaseSteps) {
  const downloads = releaseSteps.filter((step) => step.uses?.startsWith('actions/download-artifact@'));
  assert.equal(downloads.length, GROUPS.length, 'download exactly four architecture artifacts');
  for (const group of GROUPS) {
    const matches = downloads.filter((step) => step.name === `Download ${group} artifacts`);
    assert.equal(matches.length, 1, `one download for ${group}`);
    const [download] = matches;
    assert.equal(download.uses, 'actions/download-artifact@v8');
    assert.deepEqual(download.with, { name: group, path: `artifacts-incoming/${group}` });
    assert.equal(download.if, undefined);
    assert.equal(download['continue-on-error'], undefined);
  }
}

test('release downloads only named architectures before validated candidate collection', () => {
  assertArchitectureDownloads(steps);
  const collect = find('Validate and collect release artifacts');
  const indexes = find('Build signed public indexes');
  const notes = find('Render public release notes');
  const verify = find('Verify complete signed candidate');
  const upload = find('Upload validated release candidate');
  assert.equal(collect.step.run,
    'node desktop/scripts/release-artifacts.cjs collect artifacts-incoming artifacts "$RELEASE_TAG"');
  assert.equal(collect.step.env.RELEASE_TAG, '${{ steps.release_tag.outputs.tag }}');
  for (const group of GROUPS) {
    assert.ok(find(`Download ${group} artifacts`).index < collect.index);
  }
  assert.ok(collect.index < indexes.index && indexes.index < notes.index
    && notes.index < verify.index && verify.index < upload.index);
  assert.equal(indexes.step.env.GNOSI_PLUGIN_SIGNING_KEY,
    '${{ secrets.GNOSI_PLUGIN_SIGNING_KEY }}');
  assert.match(indexes.step.run, /extensions\/examples\/build_index\.py/);
  assert.match(indexes.step.run, /extensions\/marketplace\/build_vault_templates\.py/);
  assert.doesNotMatch(indexes.step.run, /if \[|-n \"\$GNOSI_PLUGIN_SIGNING_KEY\"/);
  assert.equal(verify.step.run,
    'uv run --frozen --no-default-groups python extensions/marketplace/verify_release_candidate.py --artifacts artifacts');
  assert.equal(upload.index, steps.length - 1, 'candidate upload must be the final step');
  for (const { step } of [collect, indexes, notes, verify, upload]) {
    assert.equal(step['continue-on-error'], undefined);
    assert.equal(step.if, undefined);
  }
  assert.equal(workflow.jobs.release['continue-on-error'], undefined);
  assert.deepEqual(workflow.jobs.release.needs, ['quality', 'build-macos', 'build-linux', 'build-windows']);
  assert.match(upload.step.with.path, /artifacts\/latest\*\.yml/);
  assert.doesNotMatch(upload.step.with.path, /artifacts-incoming/);
});

for (const [label, mutate] of [
  ['wildcard rerun download', (downloads) => {
    delete downloads[0].with.name;
    downloads[0].with.pattern = '*';
  }],
  ['previous candidate artifact', (downloads) => { downloads[0].with.name = 'candidate-v3.0.0-sha-1'; }],
  ['merged architecture files', (downloads) => { downloads[0].with['merge-multiple'] = true; }],
  ['shared destination', (downloads) => { downloads[0].with.path = 'artifacts-incoming'; }],
  ['missing architecture', (downloads) => { downloads.pop(); }],
  ['duplicate architecture', (downloads) => { downloads.push(structuredClone(downloads[0])); }],
  ['different run', (downloads) => { downloads[0].with['run-id'] = 123; }],
  ['conditional download', (downloads) => { downloads[0].if = '${{ always() }}'; }],
  ['ignored download failure', (downloads) => { downloads[0]['continue-on-error'] = true; }],
]) {
  test(`architecture download contract rejects ${label}`, () => {
    assertArchitectureDownloads(steps);
    const downloads = structuredClone(steps.filter((step) => step.uses?.startsWith('actions/download-artifact@')));
    mutate(downloads);
    assert.throws(() => assertArchitectureDownloads(downloads), assert.AssertionError);
  });
}

test('collector receives exactly the four architecture groups produced by build jobs', () => {
  const uploads = ['build-macos', 'build-linux', 'build-windows'].flatMap((name) => {
    const job = workflow.jobs[name];
    const upload = job.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
    assert.equal(upload.with['if-no-files-found'], 'error');
    return name === 'build-macos'
      ? job.strategy.matrix.include.map(({ arch }) => upload.with.name.replace('${{ matrix.arch }}', arch))
      : [upload.with.name];
  });
  assert.deepEqual(uploads.sort(), ['linux-arm64', 'macos-arm64', 'macos-x64', 'windows-x64']);
});

function runTagStep(t, event, requested, ref) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-release-tag-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'output');
  const { step } = find('Define release tag');
  assert.doesNotMatch(step.run, /\$\{\{/);
  const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', step.run], {
    cwd: root,
    env: { PATH: process.env.PATH, RELEASE_EVENT: event, REQUESTED_TAG: requested, REF_TAG: ref, GITHUB_OUTPUT: output },
    encoding: 'utf8',
    timeout: 5000,
  });
  return { result, root, output };
}

for (const event of ['workflow_dispatch', 'push']) {
  test(`release selects and validates the ${event} tag without shell interpolation`, (t) => {
    const tag = 'v3.0.0-rc.1';
    const probe = runTagStep(t, event, event === 'push' ? 'ignored' : tag, event === 'push' ? tag : 'ignored');
    assert.equal(probe.result.status, 0, probe.result.stderr);
    assert.equal(fs.readFileSync(probe.output, 'utf8'), `tag=${tag}\n`);
  });
}

for (const tag of ['v3.0.0\nother=bad', 'v3.0.0$(touch injected)', 'main', '']) {
  test(`release rejects an unsafe or missing tag ${JSON.stringify(tag)}`, (t) => {
    const probe = runTagStep(t, 'workflow_dispatch', tag, 'ignored');
    assert.notEqual(probe.result.status, 0);
    assert.match(probe.result.stderr, /Invalid release tag/);
    assert.equal(fs.existsSync(probe.output), false);
    assert.equal(fs.existsSync(path.join(probe.root, 'injected')), false);
  });
}
