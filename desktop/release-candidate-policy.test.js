const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');

const updaterRequire = createRequire(require.resolve('electron-updater/package.json'));
const yaml = updaterRequire('js-yaml');
const readWorkflow = (name) => yaml.load(fs.readFileSync(
  path.join(__dirname, `../.github/workflows/${name}.yml`), 'utf8',
));
const candidate = readWorkflow('build-release');
const ci = readWorkflow('ci');
const desktopScripts = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'package.json'), 'utf8',
)).scripts;
const DEPENDENCIES = {
  preflight: [],
  quality: ['preflight'],
  'build-macos': ['preflight', 'quality'],
  'build-linux': ['preflight', 'quality'],
  'build-windows': ['preflight', 'quality', 'build-macos'],
  release: ['quality', 'build-macos', 'build-linux', 'build-windows'],
};
const CANDIDATE_PATHS = [
  'artifacts/*.dmg',
  'artifacts/*.zip',
  'artifacts/*.AppImage',
  'artifacts/*.deb',
  'artifacts/*Setup*.exe',
  'artifacts/*.blockmap',
  'artifacts/latest*.yml',
  'artifacts/plugins/*.zip',
  'artifacts/plugins/plugins-index.json',
  'artifacts/plugins/plugins-index.sig',
  'artifacts/vault-templates/*.zip',
  'artifacts/vault-templates/vault-templates-index.json',
  'artifacts/vault-templates/vault-templates-index.sig',
  'artifacts/release-notes.md',
];

function assertQualityDependencies(workflow) {
  assert.deepEqual(Object.keys(workflow.jobs).sort(), Object.keys(DEPENDENCIES).sort());
  for (const [name, needs] of Object.entries(DEPENDENCIES)) {
    const job = workflow.jobs[name];
    const actual = job.needs === undefined ? [] : [job.needs].flat();
    assert.deepEqual(actual, needs, `${name} must require every preceding gate`);
  }
  const quality = workflow.jobs.quality;
  assert.equal(quality.uses, './.github/workflows/ci.yml');
  assert.deepEqual(quality.with, { release_candidate: true });
  for (const field of ['secrets', 'steps', 'runs-on', 'environment', 'strategy']) {
    assert.equal(quality[field], undefined, `quality must not define ${field}`);
  }
}

function assertFatalGates(workflow, reusableCI = false) {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.equal(job['continue-on-error'], undefined, `${name} failure must remain fatal by default`);
    assert.equal(job.if, reusableCI && name === 'documentation'
      ? "github.event_name == 'pull_request' || inputs.release_candidate" : undefined,
    `${name} must not override successful dependency gating`);
    for (const step of job.steps ?? []) {
      const label = `${name}: ${step.name ?? step.run ?? step.uses}`;
      assert.equal(step.if, undefined, `${label} must not skip validation or use always()`);
      assert.equal(step['continue-on-error'], undefined, `${label} must fail the job`);
    }
  }
}

function assertReadOnly(workflow) {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const allowedActions = new Set([
    'actions/checkout', 'pnpm/action-setup', 'actions/setup-node',
    'actions/setup-python', 'astral-sh/setup-uv',
    'actions/download-artifact', 'actions/upload-artifact',
  ]);
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (job.permissions !== undefined) {
      assert.deepEqual(job.permissions, { contents: 'read' }, `${name} cannot gain write authority`);
    }
    for (const step of job.steps ?? []) {
      if (step.uses) {
        assert.ok(allowedActions.has(step.uses.split('@')[0]), `unreviewed or publishing action: ${step.uses}`);
      }
      if (step.run) {
        assert.doesNotMatch(step.run,
          /\bgh\s+(?:release|api)\b|\b(?:createRelease|updateRelease|uploadReleaseAsset)\b|\b(?:curl|wget)\b[^\n]*(?:api\.github\.com|\/releases\b)|\b(?:npm|pnpm)\s+publish\b|--publish(?:=|\s+)(?!never\b)\S+/i,
          `${name} must not publish or mutate a GitHub release`);
      }
    }
  }
}

function assertCandidateUpload(workflow) {
  assert.equal(workflow.name, 'Build Release Candidate');
  const release = workflow.jobs.release;
  assert.equal(release.name, 'Collect candidate (publication disabled)');
  assert.deepEqual(release.permissions, { contents: 'read' });
  const uploads = release.steps.filter((step) => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(uploads.length, 1, 'upload exactly one validated candidate');
  const [upload] = uploads;
  assert.equal(upload, release.steps.at(-1), 'no steps after candidate upload');
  assert.equal(upload.name, 'Upload validated release candidate');
  assert.equal(upload.uses, 'actions/upload-artifact@v7');
  assert.deepEqual(Object.keys(upload.with).sort(), ['if-no-files-found', 'name', 'path', 'retention-days']);
  assert.equal(upload.with.name,
    'candidate-${{ steps.release_tag.outputs.tag }}-${{ github.sha }}-${{ github.run_attempt }}');
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.equal(upload.with['retention-days'], 5);
  assert.deepEqual(upload.with.path.trim().split(/\r?\n/).map((entry) => entry.trim()).sort(),
    [...CANDIDATE_PATHS].sort(), 'only validated installers, manifests, indexes and release notes');
  assert.equal(upload.if, undefined);
  assert.equal(upload['continue-on-error'], undefined);
}

function assertNonPublishingBuilds(scripts) {
  for (const platform of ['mac', 'linux', 'win']) {
    assert.equal(scripts[`build:${platform}`],
      `pnpm run build:python && electron-builder --${platform} --publish never`,
      `the indirect ${platform} build must not enable builder publication`);
  }
}

test('indirect platform build scripts explicitly disable builder publication', () => {
  assertNonPublishingBuilds(desktopScripts);
});

for (const platform of ['mac', 'linux', 'win']) {
  test(`candidate rejects indirect ${platform} publication or its implicit default`, () => {
    assertNonPublishingBuilds(desktopScripts);
    for (const replacement of ['--publish always', '']) {
      const changed = { ...desktopScripts };
      changed[`build:${platform}`] = changed[`build:${platform}`].replace('--publish never', replacement);
      assert.throws(() => assertNonPublishingBuilds(changed), assert.AssertionError);
    }
  });
}

test('tag and manual builds retain their explicit source inputs without a publish switch', () => {
  assert.deepEqual(Object.keys(candidate.on).sort(), ['push', 'workflow_dispatch']);
  assert.deepEqual(candidate.on.push, { tags: ['v*'] });
  const { inputs } = candidate.on.workflow_dispatch;
  assert.deepEqual(Object.keys(inputs), ['tag']);
  assert.equal(inputs.tag.type, 'string');
  assert.equal(inputs.tag.required, true);
  assert.equal(inputs.tag.default, undefined);
});

test('candidate quality reuses local CI at the caller commit before all builds and collection', () => {
  assertQualityDependencies(candidate);
});

test('candidate and reused CI gates fail by default without conditional bypasses', () => {
  assertFatalGates(candidate);
  assertFatalGates(ci, true);
});

test('candidate and reused CI have read-only authority and no release publisher', () => {
  assertReadOnly(candidate);
  assertReadOnly(ci);
});

test('candidate upload retains exactly the validated review payload with a unique rerun identity', () => {
  assertCandidateUpload(candidate);
});

for (const [name, dependencies] of Object.entries(DEPENDENCIES)) {
  for (const dependency of dependencies) {
    test(`candidate contract rejects ${name} without ${dependency}`, () => {
      assertQualityDependencies(candidate);
      const changed = structuredClone(candidate);
      changed.jobs[name].needs = dependencies.filter((entry) => entry !== dependency);
      assert.throws(() => assertQualityDependencies(changed), assert.AssertionError);
    });
  }
}

for (const [field, value] of [
  ['uses', './.github/workflows/ci.yml@main'],
  ['with', { release_candidate: false }],
  ['with', { release_candidate: 'true' }],
  ['with', {}],
  ['secrets', 'inherit'],
  ['secrets', { token: '${{ secrets.FIXTURE_TOKEN }}' }],
]) {
  test(`candidate quality rejects ${field}=${JSON.stringify(value)}`, () => {
    assertQualityDependencies(candidate);
    const changed = structuredClone(candidate);
    changed.jobs.quality[field] = value;
    assert.throws(() => assertQualityDependencies(changed), assert.AssertionError);
  });
}

for (const [label, workflow, reusableCI] of [['candidate', candidate, false], ['CI', ci, true]]) {
  for (const name of Object.keys(workflow.jobs)) {
    test(`${label} rejects job and step failure bypasses in ${name}`, () => {
      assertFatalGates(workflow, reusableCI);
      for (const [field, value] of [['if', '${{ always() }}'], ['if', '${{ false }}'],
        ['continue-on-error', true], ['continue-on-error', '${{ failure() }}']]) {
        const changedJob = structuredClone(workflow);
        changedJob.jobs[name][field] = value;
        assert.throws(() => assertFatalGates(changedJob, reusableCI), assert.AssertionError);
        for (let index = 0; index < (workflow.jobs[name].steps?.length ?? 0); index += 1) {
          const changedStep = structuredClone(workflow);
          changedStep.jobs[name].steps[index][field] = value;
          assert.throws(() => assertFatalGates(changedStep, reusableCI), assert.AssertionError);
        }
      }
    });
  }
}

for (const [label, mutate] of [
  ['workflow contents write', (w) => { w.permissions.contents = 'write'; }],
  ['workflow write-all', (w) => { w.permissions = 'write-all'; }],
  ['job contents write', (w) => { w.jobs.release.permissions.contents = 'write'; }],
  ['job write-all', (w) => { w.jobs.release.permissions = 'write-all'; }],
  ['draft release action', (w) => { w.jobs.release.steps.push({ uses: 'softprops/action-gh-release@v3', with: { draft: true } }); }],
  ['alternate release action', (w) => { w.jobs.release.steps.push({ uses: 'ncipollo/release-action@v1' }); }],
  ['script action publisher', (w) => { w.jobs.release.steps.push({ uses: 'actions/github-script@v8' }); }],
  ['CLI draft creation', (w) => { w.jobs.release.steps.push({ run: 'gh release create v3.0.0 --draft' }); }],
  ['CLI release upload', (w) => { w.jobs.release.steps.push({ run: 'gh release upload v3.0.0 artifacts/*.zip' }); }],
  ['GitHub release API', (w) => { w.jobs.release.steps.push({ run: 'gh api repos/fixture/fixture/releases -X POST' }); }],
  ['HTTP release API', (w) => { w.jobs.release.steps.push({ run: 'curl -X POST https://api.github.com/repos/fixture/fixture/releases' }); }],
  ['builder publication', (w) => { w.jobs['build-linux'].steps.push({ run: 'electron-builder --linux --publish always' }); }],
]) {
  test(`read-only candidate rejects ${label}`, () => {
    assertReadOnly(candidate);
    const changed = structuredClone(candidate);
    mutate(changed);
    assert.throws(() => assertReadOnly(changed), assert.AssertionError);
  });
}

for (const [label, mutate] of [
  ['rerun collision', (upload) => { upload.with.name = 'candidate-${{ steps.release_tag.outputs.tag }}-${{ github.sha }}'; }],
  ['missing SHA identity', (upload) => { upload.with.name = 'candidate-${{ steps.release_tag.outputs.tag }}-${{ github.run_attempt }}'; }],
  ['empty files warning', (upload) => { upload.with['if-no-files-found'] = 'warn'; }],
  ['long retention', (upload) => { upload.with['retention-days'] = 90; }],
  ['overwrite', (upload) => { upload.with.overwrite = true; }],
  ['workspace glob', (upload) => { upload.with.path = '**/*'; }],
  ['incoming artifacts', (upload) => { upload.with.path += '\nartifacts-incoming/**'; }],
  ['hidden files', (upload) => { upload.with['include-hidden-files'] = true; }],
]) {
  test(`candidate upload rejects ${label}`, () => {
    assertCandidateUpload(candidate);
    const changed = structuredClone(candidate);
    mutate(changed.jobs.release.steps.at(-1));
    assert.throws(() => assertCandidateUpload(changed), assert.AssertionError);
  });
}

for (const requiredPath of CANDIDATE_PATHS) {
  test(`candidate upload rejects missing ${requiredPath}`, () => {
    assertCandidateUpload(candidate);
    const changed = structuredClone(candidate);
    const upload = changed.jobs.release.steps.at(-1);
    upload.with.path = upload.with.path.split('\n').filter((entry) => entry.trim() !== requiredPath).join('\n');
    assert.throws(() => assertCandidateUpload(changed), assert.AssertionError);
  });
}
