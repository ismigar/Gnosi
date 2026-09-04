const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const sourceRoot = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 10_000,
    ...options,
  });
}

function writeExecutable(file, source) {
  fs.writeFileSync(file, source, { mode: 0o755 });
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gnosi-release-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of [
    'desktop/scripts',
    'frontend/scripts',
    'frontend/src/features/control-center/releases',
    'frontend/src/shared/i18n/locales/en',
    'fake-bin',
  ]) fs.mkdirSync(path.join(root, directory), { recursive: true });

  for (const relative of [
    'desktop/release.sh',
    'desktop/scripts/sync-release-version.cjs',
    'desktop/scripts/release-metadata.cjs',
  ]) fs.copyFileSync(path.join(sourceRoot, relative), path.join(root, relative));
  fs.chmodSync(path.join(root, 'desktop/release.sh'), 0o755);

  const manifest = (name) => `${JSON.stringify({ name, version: '3.0.0' }, null, 2)}\n`;
  fs.writeFileSync(path.join(root, 'package.json'), manifest('fixture'));
  fs.writeFileSync(path.join(root, 'desktop/package.json'), manifest('@fixture/desktop'));
  fs.writeFileSync(path.join(root, 'frontend/package.json'), manifest('@fixture/frontend'));
  fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "fixture"\nversion = "3.0.0"\n');
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  fs.writeFileSync(path.join(root, 'uv.lock'), 'version = 1\n');

  const key = 'release_notes.entries.v3_0_0.highlights.ready';
  fs.writeFileSync(path.join(root, 'frontend/src/features/control-center/releases/releases.json'),
    `${JSON.stringify([{
      version: '3.0.0',
      date: '2026-09-03',
      channel: 'stable',
      downloadUrl: 'https://github.com/ismigar/Gnosi/releases/tag/v3.0.0',
      sections: { highlights: [key], improvements: [], fixes: [] },
    }], null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'frontend/src/shared/i18n/locales/en/translation.json'),
    `${JSON.stringify({ release_notes: {
      channel_prerelease: 'Release candidate',
      channel_stable: 'Stable',
      section_highlights: 'Highlights',
      section_improvements: 'Improvements',
      section_fixes: 'Fixes',
      entries: { v3_0_0: { highlights: { ready: 'Verified release.' } } },
    } }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# stale\n');

  writeExecutable(path.join(root, 'frontend/scripts/release-notes.mjs'),
    '#!/usr/bin/env node\nprocess.exit(process.argv.includes("--check") ? 0 : 2);\n');
  fs.writeFileSync(path.join(root, 'desktop/scripts/release-artifacts.cjs'), `
    const fs = require('node:fs');
    const [, , operation, group, directory] = process.argv;
    if (operation !== 'validate' || !fs.statSync(directory).isDirectory()) process.exit(2);
    fs.appendFileSync(process.env.GNOSI_TEST_LOG, \`artifact \${group}\n\`);
  `);

  const log = path.join(os.tmpdir(), `gnosi-release-contract-${path.basename(root)}.log`);
  t.after(() => fs.rmSync(log, { force: true }));
  writeExecutable(path.join(root, 'fake-bin/pnpm'), `#!/bin/bash
set -eu
printf 'pnpm %s offline=%s frozen=%s\\n' "$*" "\${PNPM_CONFIG_OFFLINE:-}" "\${UV_FROZEN:-}" >> "$GNOSI_TEST_LOG"
if [ "\${GNOSI_TEST_MUTATE_LOCK:-}" = "1" ] && [ "$1" = "build:frontend" ]; then
  printf 'mutated\\n' >> pnpm-lock.yaml
fi
`);
  writeExecutable(path.join(root, 'fake-bin/uname'), '#!/bin/bash\nprintf "Darwin\\n"\n');

  const git = (...args) => {
    const result = run('git', args, { cwd: root });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  git('config', 'user.name', 'Gnosi Test');
  git('config', 'user.email', 'gnosi-test@example.invalid');

  const env = {
    ...process.env,
    PATH: `${path.join(root, 'fake-bin')}:${process.env.PATH}`,
    GNOSI_TEST_LOG: log,
  };
  const release = (...args) => run('bash', [path.join(root, 'desktop/release.sh'), ...args], {
    cwd: root,
    env,
  });
  const commit = (message = 'fixture') => {
    git('add', '.');
    git('commit', '-qm', message);
  };
  commit();
  return { root, log, env, git, commit, release };
}

function ownedSnapshot(root) {
  return [
    'package.json',
    'desktop/package.json',
    'frontend/package.json',
    'pyproject.toml',
    'frontend/src/features/control-center/releases/releases.json',
    'CHANGELOG.md',
    'pnpm-lock.yaml',
    'uv.lock',
  ].map((relative) => fs.readFileSync(path.join(root, relative), 'utf8'));
}

test('checked-in 3.0.0 metadata remains unpublished until explicit promotion', () => {
  const releases = JSON.parse(fs.readFileSync(path.join(sourceRoot,
    'frontend/src/features/control-center/releases/releases.json'), 'utf8'));
  assert.equal(releases[0].version, '3.0.0');
  assert.equal(releases[0].channel, 'prerelease');
  assert.equal(Object.hasOwn(releases[0], 'downloadUrl'), false);
  assert.match(fs.readFileSync(path.join(sourceRoot, 'CHANGELOG.md'), 'utf8'),
    /## Gnosi 3\.0\.0\n\n_2026-09-02 · Release candidate_/);
});

test('prepare is transactional, leaves locks untouched and never invokes dependency tools', (t) => {
  const f = fixture(t);
  const lockBefore = ownedSnapshot(f.root).slice(-2);
  const result = f.release('prepare', '3.0.0');
  assert.equal(result.status, 0, result.stderr);
  const release = JSON.parse(fs.readFileSync(path.join(f.root,
    'frontend/src/features/control-center/releases/releases.json'), 'utf8'))[0];
  assert.equal(release.channel, 'prerelease');
  assert.equal(Object.hasOwn(release, 'downloadUrl'), false);
  assert.match(fs.readFileSync(path.join(f.root, 'CHANGELOG.md'), 'utf8'), /Release candidate/);
  assert.deepEqual(ownedSnapshot(f.root).slice(-2), lockBefore);
  assert.equal(fs.existsSync(f.log), false, 'prepare must not call pnpm, uv or artifact tools');
});

test('failed preparation restores every owned file byte for byte', (t) => {
  const f = fixture(t);
  const before = ownedSnapshot(f.root);
  const result = f.release('prepare', '3.0.1');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /all preparation-owned files were restored/);
  assert.deepEqual(ownedSnapshot(f.root), before);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('immutable packaging rejects a dirty tree before invoking tools', (t) => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, 'package.json'), '\n');
  const result = f.release('package', '3.0.0');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires a clean worktree/);
  assert.equal(fs.existsSync(f.log), false);
});

test('immutable packaging consumes both locks offline and preserves the source tree', (t) => {
  const f = fixture(t);
  assert.equal(f.release('prepare', '3.0.0').status, 0);
  f.commit('pending release');
  const before = ownedSnapshot(f.root);
  const result = f.release('package', '3.0.0');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(ownedSnapshot(f.root), before);
  assert.equal(f.git('status', '--porcelain'), '');
  const log = fs.readFileSync(f.log, 'utf8');
  assert.match(log, /pnpm install --frozen-lockfile --offline --ignore-scripts offline=true frozen=true/);
  assert.match(log, /pnpm build:frontend offline=true frozen=true/);
  assert.match(log, /pnpm --filter @gnosi\/desktop build:mac offline=true frozen=true/);
});

test('packaging fails closed if a downstream build mutates a frozen lock', (t) => {
  const f = fixture(t);
  assert.equal(f.release('prepare', '3.0.0').status, 0);
  f.commit('pending release');
  const result = run('bash', [path.join(f.root, 'desktop/release.sh'), 'package', '3.0.0'], {
    cwd: f.root,
    env: { ...f.env, GNOSI_TEST_MUTATE_LOCK: '1' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /frozen lock changed/);
  assert.notEqual(f.git('status', '--porcelain'), '', 'unexpected mutation remains visible for review');
});

test('promotion requires the tagged source, four verified groups and exact published URL', (t) => {
  const f = fixture(t);
  assert.equal(f.release('prepare', '3.0.0').status, 0);
  f.commit('pending release');
  f.git('tag', '-a', 'v3.0.0', '-m', 'fixture release');
  const artifacts = path.join(f.root, 'verified-artifacts');
  for (const group of ['macos-x64', 'macos-arm64', 'linux-arm64', 'windows-x64']) {
    fs.mkdirSync(path.join(artifacts, group), { recursive: true });
  }
  const url = 'https://github.com/ismigar/Gnosi/releases/tag/v3.0.0';
  const result = f.release('promote', '3.0.0', artifacts, url);
  assert.equal(result.status, 0, result.stderr);
  const release = JSON.parse(fs.readFileSync(path.join(f.root,
    'frontend/src/features/control-center/releases/releases.json'), 'utf8'))[0];
  assert.equal(release.channel, 'stable');
  assert.equal(release.downloadUrl, url);
  assert.match(fs.readFileSync(path.join(f.root, 'CHANGELOG.md'), 'utf8'), /· Stable_/);
  assert.equal(fs.readFileSync(f.log, 'utf8').split('\n').filter(Boolean).length, 4);
});

test('promotion cannot proceed without a tag', (t) => {
  const f = fixture(t);
  assert.equal(f.release('prepare', '3.0.0').status, 0);
  f.commit('pending release');
  const artifacts = path.join(f.root, 'verified-artifacts');
  fs.mkdirSync(artifacts);
  const before = ownedSnapshot(f.root);
  const result = f.release('promote', '3.0.0', artifacts,
    'https://github.com/ismigar/Gnosi/releases/tag/v9.9.9');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tag v3\.0\.0 is missing/);
  assert.deepEqual(ownedSnapshot(f.root), before);
});

test('promotion cannot invent a release URL after the source is tagged', (t) => {
  const f = fixture(t);
  assert.equal(f.release('prepare', '3.0.0').status, 0);
  f.commit('pending release');
  f.git('tag', '-a', 'v3.0.0', '-m', 'fixture release');
  const artifacts = path.join(f.root, 'verified-artifacts');
  for (const group of ['macos-x64', 'macos-arm64', 'linux-arm64', 'windows-x64']) {
    fs.mkdirSync(path.join(artifacts, group), { recursive: true });
  }
  const before = ownedSnapshot(f.root);
  const result = f.release('promote', '3.0.0', artifacts,
    'https://github.com/ismigar/Gnosi/releases/tag/v9.9.9');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Published release URL must be exactly/);
  assert.deepEqual(ownedSnapshot(f.root), before);
});

test('release shell contains no mutable lock resolution or network command', () => {
  const source = fs.readFileSync(path.join(sourceRoot, 'desktop/release.sh'), 'utf8');
  assert.doesNotMatch(source, /pnpm install --lockfile-only|\buv lock\b/);
  assert.doesNotMatch(source, /\bcurl\b|\bwget\b|gh release|git push|git fetch/);
  assert.match(source, /pnpm install --frozen-lockfile --offline --ignore-scripts/);
  assert.match(source, /UV_OFFLINE=true/);
});
