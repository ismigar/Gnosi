const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { gzipSync } = require('node:zlib');

const { collectArtifacts, validateBuild } = require('./scripts/release-artifacts.cjs');
const updaterRequire = createRequire(require.resolve('electron-updater/package.json'));
const yaml = updaterRequire('js-yaml');
const { parseUpdateInfo, resolveFiles } = require('electron-updater/out/providers/Provider');
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider');
const semver = updaterRequire('semver');
const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
const { createUpdateInfoTasks, writeUpdateInfoFiles } = builderRequire('app-builder-lib/out/publish/updateInfoBuilder');
const { getPublishConfigs } = builderRequire('app-builder-lib/out/publish/PublishManager');
const { AppInfo } = builderRequire('app-builder-lib/out/appInfo');
const { Platform } = builderRequire('app-builder-lib/out/core');
const FpmTarget = builderRequire('app-builder-lib/out/targets/FpmTarget').default;
const BUILDER_CONFIG = yaml.load(fs.readFileSync(path.join(__dirname, 'electron-builder.yml'), 'utf8'));
const { Arch } = builderRequire('builder-util');
const VERSION = require('./package.json').version;
const SCRIPT = path.join(__dirname, 'scripts/release-artifacts.cjs');
const GROUPS = {
  'macos-x64': ['latest-mac.yml', ['x64.zip', 'x64.dmg'], Arch.x64],
  'macos-arm64': ['latest-mac.yml', ['arm64.zip', 'arm64.dmg'], Arch.arm64],
  'linux-arm64': ['latest-linux-arm64.yml', ['arm64.AppImage', 'arm64.deb'], Arch.arm64],
  'windows-x64': ['latest.yml', ['Setup.exe'], Arch.x64],
};

async function fixture(t, { installerUpdateInfo = true, version = VERSION } = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gnosi-release-artifacts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'incoming');
  const output = path.join(root, 'collected');
  fs.mkdirSync(input);
  for (const [group, [, suffixes, arch]] of Object.entries(GROUPS)) {
    const directory = path.join(input, group);
    fs.mkdirSync(directory);
    const tasks = [];
    for (const suffix of suffixes) {
      const name = `Gnosi-${version}-${suffix}`;
      const bytes = Buffer.from(`Synthetic builder artifact: ${name}\n`.repeat(8));
      fs.writeFileSync(path.join(directory, name), bytes);
      const sha512 = createHash('sha512').update(bytes).digest('base64');
      const updateInfo = { sha512, size: bytes.length };
      if (name.endsWith('.AppImage')) updateInfo.blockMapSize = 24;
      if (name.endsWith('.exe')) updateInfo.isAdminRightsRequired = false;
      if (/\.(zip|exe)$/.test(name) || (name.endsWith('.dmg') && installerUpdateInfo)) {
        const blockmap = gzipSync(JSON.stringify({ version: '2', files: [] }));
        fs.writeFileSync(path.join(directory, `${name}.blockmap`), blockmap);
      }
      // FpmTarget.build only sets isWriteUpdateInfo/updateInfo when publishConfig
      // is non-null. DmgTarget.build gates it on writeUpdateInfo !== false.
      // AppImage and macOS ZIP events request update metadata. Exercise their
      // event-to-channel conversion with the installed builder, without packing.
      if (!installerUpdateInfo && /\.(deb|dmg)$/.test(name)) continue;
      const event = {
        file: path.join(directory, name),
        arch,
        target: { outDir: directory },
        isWriteUpdateInfo: true,
        updateInfo,
        packager: {
          platform: group.startsWith('macos-') ? Platform.MAC
            : group.startsWith('linux-') ? Platform.LINUX : Platform.WINDOWS,
          appInfo: {
            version,
            channel: Object.getOwnPropertyDescriptor(AppInfo.prototype, 'channel').get.call({ version }),
          },
          platformSpecificBuildOptions: {},
          config: {
            publish: { ...BUILDER_CONFIG.publish, owner: 'fixture', repo: 'fixture' },
            releaseInfo: {
            releaseName: `Gnosi ${version}`,
            releaseNotes: 'First paragraph.\n\nSecond paragraph: accented text, català.\n',
            releaseDate: group === 'macos-arm64' ? '2026-08-30T11:00:00.000Z' : '2026-08-30T10:00:00.000Z',
          } },
          getResource: async () => null,
          expandMacro: (value) => value,
          info: { metadata: { dependencies: { 'electron-updater': '6.8.9' } } },
        },
      };
      event.packager.info.config = event.packager.config;
      event.packager.info.appInfo = event.packager.appInfo;
      // Explicit fixture owner/repo avoid credential/repository discovery and no
      // publisher is instantiated. Resolve the checked-in provider/channel policy.
      const publishConfigs = await getPublishConfigs(event.packager, null, arch, false);
      tasks.push(...await createUpdateInfoTasks(event, publishConfigs));
    }
    // The emitter belongs to writeUpdateInfoFiles' second argument, not each
    // task; otherwise the real serializer fails with emitArtifactCreated missing.
    await writeUpdateInfoFiles(tasks.reverse(), { emitArtifactCreated: async () => {} });
  }
  return {
    root, input, output,
    channel(group) { return path.join(input, group, GROUPS[group][0]); },
    asset(group, suffix) { return path.join(input, group, `Gnosi-${version}-${suffix}`); },
    edit(group, change) {
      const target = this.channel(group);
      const document = yaml.load(fs.readFileSync(target, 'utf8'));
      change(document);
      fs.writeFileSync(target, yaml.dump(document));
    },
    collect() { return collectArtifacts(input, output, version); },
  };
}

function snapshot(directory) {
  return Object.fromEntries(fs.readdirSync(directory, { recursive: true })
    .filter((name) => fs.lstatSync(path.join(directory, name)).isFile())
    .map((name) => [name, fs.readFileSync(path.join(directory, name), 'base64')]));
}

async function rejectsWithoutOutput(f, pattern) {
  await assert.rejects(f.collect(), pattern);
  assert.equal(fs.existsSync(f.output), false, 'validation must finish before writing any output');
}

test('collects actual builder YAML, preserving Linux/Windows and both Mac architectures', async (t) => {
  const f = await fixture(t);
  const before = snapshot(f.input);
  const merged = await f.collect();
  assert.deepEqual(snapshot(f.input), before, 'source architecture artifacts remain intact');
  const raw = fs.readFileSync(path.join(f.output, 'latest-mac.yml'), 'utf8');
  const info = parseUpdateInfo(raw, 'latest-mac.yml', 'https://example.invalid/latest-mac.yml');
  assert.deepEqual(info, merged);
  assert.deepEqual(info.files.map((file) => file.url), [
    `Gnosi-${VERSION}-x64.zip`, `Gnosi-${VERSION}-arm64.zip`,
    `Gnosi-${VERSION}-x64.dmg`, `Gnosi-${VERSION}-arm64.dmg`,
  ]);
  assert.equal(info.path, `Gnosi-${VERSION}-x64.zip`);
  assert.equal(info.sha512, info.files[0].sha512);
  assert.equal(info.releaseDate, '2026-08-30T11:00:00.000Z');
  assert.match(info.releaseNotes, /Second paragraph: accented text, català/);
  const resolved = resolveFiles(info, new URL('https://example.invalid/download/'));
  for (const arch of ['x64', 'arm64']) {
    const zip = resolved.find((file) => file.url.pathname.endsWith(`-${arch}.zip`));
    assert.ok(zip, `updater can resolve the ${arch} ZIP`);
    const bytes = fs.readFileSync(path.join(f.output, zip.info.url));
    assert.equal(createHash('sha512').update(bytes).digest('base64'), zip.info.sha512);
  }
  for (const group of ['linux-arm64', 'windows-x64']) {
    const channel = GROUPS[group][0];
    assert.equal(fs.readFileSync(path.join(f.output, channel), 'utf8'),
      fs.readFileSync(f.channel(group), 'utf8'));
  }
  assert.equal(fs.existsSync(path.join(f.output, 'latest-linux.yml')), false);
  assert.equal(fs.readdirSync(f.output).length, 15);
  for (const [relative, bytes] of Object.entries(before)) {
    const name = path.basename(relative);
    if (name !== 'latest-mac.yml') {
      assert.equal(fs.readFileSync(path.join(f.output, name), 'base64'), bytes);
    }
  }
});

test('installed builder supports DEB updates but gates their emission on publish configuration', async (t) => {
  assert.equal(builderRequire('app-builder-lib/package.json').version, '26.15.3');
  assert.equal(FpmTarget.prototype.supportsAutoUpdate('deb'), true);
  const source = fs.readFileSync(builderRequire.resolve('app-builder-lib/out/targets/FpmTarget'), 'utf8');
  assert.match(source, /const publishConfig = this\.supportsAutoUpdate\(target\)[\s\S]*?: null;/);
  assert.match(source, /if \(publishConfig != null\) \{\s+info = \{[\s\S]*?isWriteUpdateInfo: true/);
  const f = await fixture(t);
  const linux = yaml.load(fs.readFileSync(f.channel('linux-arm64'), 'utf8'));
  assert.deepEqual(linux.files.map((file) => path.extname(file.url)).sort(), ['.AppImage', '.deb']);
});

test('accepts ZIP-only Mac and AppImage-only Linux metadata while retaining all installers', async (t) => {
  const f = await fixture(t, { installerUpdateInfo: false });
  for (const group of Object.keys(GROUPS)) {
    await validateBuild(group, path.join(f.input, group), VERSION);
  }
  const merged = await f.collect();
  assert.deepEqual(merged.files.map((file) => file.url), [
    `Gnosi-${VERSION}-x64.zip`, `Gnosi-${VERSION}-arm64.zip`,
  ]);
  const linux = yaml.load(fs.readFileSync(path.join(f.output, 'latest-linux-arm64.yml'), 'utf8'));
  assert.deepEqual(linux.files.map((file) => file.url), [`Gnosi-${VERSION}-arm64.AppImage`]);
  for (const [group, suffix] of [['macos-x64', 'x64.dmg'], ['macos-arm64', 'arm64.dmg'], ['linux-arm64', 'arm64.deb']]) {
    const original = f.asset(group, suffix);
    assert.deepEqual(fs.readFileSync(path.join(f.output, path.basename(original))), fs.readFileSync(original));
  }
});

for (const [group, suffix] of [['macos-x64', 'x64.dmg'], ['macos-arm64', 'arm64.dmg'], ['linux-arm64', 'arm64.deb']]) {
  test(`requires ${suffix} on disk even when absent from the update manifest`, async (t) => {
    const f = await fixture(t, { installerUpdateInfo: false });
    fs.unlinkSync(f.asset(group, suffix));
    await rejectsWithoutOutput(f, /Missing required artifact/);
  });
  test(`verifies the hash of ${suffix} when the builder does list it`, async (t) => {
    const f = await fixture(t);
    f.edit(group, (m) => { m.files.find((file) => file.url.endsWith(suffix)).sha512 = 'bad'; });
    await rejectsWithoutOutput(f, /SHA-512 mismatch/);
  });
}

test('rejects a Linux channel that lists DEB but omits AppImage', async (t) => {
  const f = await fixture(t);
  f.edit('linux-arm64', (m) => { m.files = m.files.filter((file) => file.url.endsWith('.deb')); });
  await rejectsWithoutOutput(f, /Missing updater reference/);
});

test('accepts missing optional size metadata while still verifying the payload hash', async (t) => {
  const f = await fixture(t);
  f.edit('macos-arm64', (m) => { delete m.files[0].size; });
  await f.collect();
});

test('RC builds resolve the checked-in GitHub config to latest channels and match upload paths', async (t) => {
  const version = '3.0.0-rc.1';
  const f = await fixture(t, { version });
  const workflow = yaml.load(fs.readFileSync(path.join(__dirname, '../.github/workflows/build-release.yml'), 'utf8'));
  for (const [group, [channel]] of Object.entries(GROUPS)) {
    const directory = path.join(f.input, group);
    assert.deepEqual(fs.readdirSync(directory).filter((name) => name.endsWith('.yml')), [channel]);
    assert.equal(yaml.load(fs.readFileSync(f.channel(group), 'utf8')).version, version);
    await validateBuild(group, directory, version);
    const jobName = group.startsWith('macos-') ? 'build-macos'
      : group.startsWith('linux-') ? 'build-linux' : 'build-windows';
    const upload = workflow.jobs[jobName].steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
    assert.ok(upload.with.path.split('\n').includes(`desktop/dist/${channel}`));
  }
  const merged = await f.collect();
  assert.equal(merged.version, version);
  assert.deepEqual(merged.files.filter((file) => file.url.endsWith('.zip')).map((file) => file.url), [
    `Gnosi-${version}-x64.zip`, `Gnosi-${version}-arm64.zip`,
  ]);
});

test('installed GitHub updater consumes RC latest channels through its prerelease fallback offline', async (t) => {
  const version = '3.0.0-rc.1';
  const f = await fixture(t, { version });
  await f.collect();
  const previousArch = process.env.TEST_UPDATER_ARCH;
  process.env.TEST_UPDATER_ARCH = 'arm64';
  t.after(() => {
    if (previousArch === undefined) delete process.env.TEST_UPDATER_ARCH;
    else process.env.TEST_UPDATER_ARCH = previousArch;
  });
  for (const [platform, channel] of [['darwin', 'latest-mac.yml'],
    ['linux', 'latest-linux-arm64.yml'], ['win32', 'latest.yml']]) {
    const requested = [];
    const provider = new GitHubProvider({ provider: 'github', owner: 'fixture', repo: 'fixture' }, {
      allowPrerelease: true,
      currentVersion: semver.parse('3.0.0-rc.0'),
    }, {
      platform,
      executor: { request: async (options) => {
        requested.push(options.path);
        if (options.path.endsWith(`/${channel.replace('latest', 'rc')}`)) {
          throw new Error('Fixture: RC channel does not exist');
        }
        assert.ok(options.path.endsWith(`/${channel}`), 'only the expected fallback may be read');
        return fs.readFileSync(path.join(f.output, channel), 'utf8');
      } },
    });
    // Intercept the Atom request too: no network or Electron process is used.
    provider.httpRequest = async (url) => {
      assert.ok(url.pathname.endsWith('/releases.atom'));
      return `<feed><entry><title>Fixture RC</title><link href="https://github.com/fixture/fixture/releases/tag/v${version}"/></entry></feed>`;
    };
    const info = await provider.getLatestVersion();
    assert.equal(info.version, version);
    assert.deepEqual(requested, [
      `/fixture/fixture/releases/download/v${version}/${channel.replace('latest', 'rc')}`,
      `/fixture/fixture/releases/download/v${version}/${channel}`,
    ]);
  }
});

test('pre-upload validation ignores unpacked apps/diagnostics, but requires the actual channel', async (t) => {
  const f = await fixture(t);
  for (const group of Object.keys(GROUPS)) {
    const directory = path.join(f.input, group);
    fs.mkdirSync(path.join(directory, 'unpacked'));
    fs.writeFileSync(path.join(directory, 'builder-debug.yml'), 'debug: true\n');
    fs.writeFileSync(path.join(directory, 'builder-effective-config.yaml'), 'diagnostic: true\n');
    await validateBuild(group, directory, VERSION);
  }
  const channel = f.channel('linux-arm64');
  fs.renameSync(channel, path.join(path.dirname(channel), 'latest-linux.yml'));
  await assert.rejects(validateBuild('linux-arm64', path.dirname(channel), VERSION), /latest-linux-arm64\.yml/);
  assert.equal(fs.existsSync(channel), false, 'do not synthesize or rename the Linux channel');
});

for (const group of Object.keys(GROUPS)) {
  test(`fails before writing if ${group} or its channel is absent`, async (t) => {
    const f = await fixture(t);
    fs.unlinkSync(f.channel(group));
    await rejectsWithoutOutput(f, /Missing required channel/);
    fs.renameSync(path.join(f.input, group), path.join(f.root, group));
    await rejectsWithoutOutput(f, /Expected exactly/);
  });
  for (const suffix of GROUPS[group][1]) {
    test(`rejects missing ${group}/${suffix}`, async (t) => {
      const f = await fixture(t);
      fs.unlinkSync(f.asset(group, suffix));
      await rejectsWithoutOutput(f, /Missing|Orphan blockmap/);
    });
  }
}

for (const group of ['macos-x64', 'macos-arm64', 'linux-arm64', 'windows-x64']) {
  test(`rejects mismatched versions and corrupt hashes for ${group}`, async (t) => {
    const f = await fixture(t);
    f.edit(group, (manifest) => { manifest.version = '0.0.1'; });
    await rejectsWithoutOutput(f, /Version mismatch/);
    f.edit(group, (manifest) => {
      manifest.version = VERSION;
      manifest.files[0].sha512 = 'A'.repeat(88);
    });
    await rejectsWithoutOutput(f, /SHA-512 mismatch/);
  });
}

for (const [label, change, error] of [
  ['wrong size', (m) => { m.files[0].size += 1; }, /Size mismatch/],
  ['missing hash', (m) => { delete m.files[0].sha512; }, /SHA-512 mismatch/],
  ['duplicate entry', (m) => { m.files.push({ ...m.files[0] }); }, /Duplicate artifact reference/],
  ['missing updater entry', (m) => { m.files.shift(); }, /Missing updater reference/],
  ['legacy hash', (m) => { m.sha512 = 'bad'; }, /Invalid legacy/],
  ['legacy path', (m) => { m.path = `Gnosi-${VERSION}-other.zip`; }, /Invalid legacy/],
  ['non-ZIP legacy path', (m) => { m.path = m.files[1].url; m.sha512 = m.files[1].sha512; }, /legacy path must reference its ZIP/],
  ['wrong architecture', (m) => { m.files[0].url = `Gnosi-${VERSION}-x64.zip`; }, /Wrong architecture/],
  ['missing version', (m) => { delete m.version; }, /Invalid release version/],
  ['invalid date', (m) => { m.releaseDate = 'not-a-date'; }, /Invalid releaseDate/],
  ['extra package references', (m) => { m.packages = { x64: { path: '../payload' } }; }, /Unsupported manifest field/],
  ['extra URL field', (m) => { m.files[0].path = '../payload'; }, /Unsupported file field/],
]) {
  test(`rejects ${label}`, async (t) => {
    const f = await fixture(t);
    f.edit('macos-arm64', change);
    await rejectsWithoutOutput(f, error);
  });
}

for (const unsafe of ['../escape.zip', '/absolute.zip', 'C:\\escape.zip', 'dir\\escape.zip',
  'https://example.invalid/evil.zip', '//host/evil.zip', '%2e%2e%2fescape.zip',
  'artifact.zip?token=x', 'artifact.zip#fragment', 'NUL.zip', 'name.zip.']) {
  test(`rejects unsafe manifest reference ${unsafe}`, async (t) => {
    const f = await fixture(t);
    f.edit('macos-arm64', (m) => { m.files[0].url = unsafe; });
    await rejectsWithoutOutput(f, /Unsafe artifact path/);
  });
}

test('rejects conflicting Mac metadata while allowing different build timestamps', async (t) => {
  const f = await fixture(t);
  f.edit('macos-arm64', (m) => { m.stagingPercentage = 25; });
  await rejectsWithoutOutput(f, /Conflicting macOS release metadata/);
});

test('rejects changed artifact bytes for either Mac architecture even when sizes match', async (t) => {
  for (const arch of ['x64', 'arm64']) {
    const f = await fixture(t);
    const target = f.asset(`macos-${arch}`, `${arch}.zip`);
    const bytes = fs.readFileSync(target);
    bytes[0] ^= 1;
    fs.writeFileSync(target, bytes);
    await rejectsWithoutOutput(f, /SHA-512 mismatch/);
  }
});

test('does not write an aggregate if copied bytes change after validation', async (t) => {
  const f = await fixture(t);
  const originalCopy = fsp.copyFile;
  t.mock.method(fsp, 'copyFile', async (source, destination, flags) => {
    await originalCopy(source, destination, flags);
    fs.appendFileSync(destination, 'changed');
  });
  await assert.rejects(f.collect(), /Artifact changed during collection/);
  assert.equal(fs.existsSync(path.join(f.output, 'latest-mac.yml')), false);
});

test('rejects identical-name and case-insensitive collisions across architecture directories', async (t) => {
  for (const secondName of ['shared.blockmap', 'SHARED.blockmap']) {
    const f = await fixture(t);
    fs.writeFileSync(path.join(f.input, 'macos-arm64', 'shared.blockmap'), 'same bytes');
    fs.writeFileSync(path.join(f.input, 'macos-x64', secondName), 'same bytes');
    await rejectsWithoutOutput(f, /Artifact name collision/);
  }
});

test('rejects malformed YAML and duplicate YAML keys without creating output', async (t) => {
  for (const raw of ['files: [', 'version: 2.0.6\nversion: 3.0.0\n', '[]\n', 'null\n']) {
    const f = await fixture(t);
    fs.writeFileSync(f.channel('macos-arm64'), raw);
    await rejectsWithoutOutput(f, /YAML|flow collection|duplicated mapping key|Invalid manifest/);
  }
});

test('rejects an empty payload, unreferenced sidecar and unsafe filename', async (t) => {
  const empty = await fixture(t);
  fs.writeFileSync(empty.asset('macos-arm64', 'arm64.zip'), '');
  await rejectsWithoutOutput(empty, /empty or unsafe artifact/);
  const extra = await fixture(t);
  fs.writeFileSync(path.join(extra.input, 'macos-arm64', 'orphan.blockmap'), 'bytes');
  await rejectsWithoutOutput(extra, /Unexpected artifact/);
  const unsafe = await fixture(t);
  fs.writeFileSync(path.join(unsafe.input, 'macos-arm64', 'escaped%2f.zip'), 'bytes');
  await rejectsWithoutOutput(unsafe, /Unsafe artifact path/);
});

test('rejects symlinked files, manifests and architecture directories', async (t) => {
  for (const kind of ['file', 'manifest', 'directory']) {
    const f = await fixture(t);
    const target = kind === 'directory' ? path.join(f.input, 'macos-arm64')
      : kind === 'manifest' ? f.channel('macos-arm64') : f.asset('macos-arm64', 'arm64.zip');
    const moved = path.join(f.root, `outside-${kind}`);
    fs.renameSync(target, moved);
    fs.symlinkSync(moved, target, kind === 'directory' ? 'dir' : 'file');
    await rejectsWithoutOutput(f, /[Uu]nsafe/);
  }
});

test('rejects nested upload folders and unknown artifact groups', async (t) => {
  const nested = await fixture(t);
  fs.mkdirSync(path.join(nested.input, 'macos-arm64', 'nested'));
  await rejectsWithoutOutput(nested, /unsafe artifact/);
  const extra = await fixture(t);
  fs.mkdirSync(path.join(extra.input, 'unknown-platform'));
  await rejectsWithoutOutput(extra, /Expected exactly/);
});

test('never overwrites output or writes into the downloaded input', async (t) => {
  const f = await fixture(t);
  fs.mkdirSync(f.output);
  fs.writeFileSync(path.join(f.output, 'latest-mac.yml'), 'existing contents');
  await assert.rejects(f.collect(), /Output already exists/);
  assert.equal(fs.readFileSync(path.join(f.output, 'latest-mac.yml'), 'utf8'), 'existing contents');
  await assert.rejects(collectArtifacts(f.input, path.join(f.input, 'merged'), VERSION), /must be separate/);
  await assert.rejects(collectArtifacts(f.input, f.input, VERSION), /must be separate/);
});

test('CLI validates and collects with the checked-out version and fails on a different tag', async (t) => {
  const f = await fixture(t);
  const validation = spawnSync(process.execPath,
    [SCRIPT, 'validate', 'macos-arm64', path.join(f.input, 'macos-arm64')], { encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr);
  const wrongTag = spawnSync(process.execPath,
    [SCRIPT, 'collect', f.input, f.output, 'v0.0.1'], { encoding: 'utf8' });
  assert.equal(wrongTag.status, 1);
  assert.match(wrongTag.stderr, /tag does not match/);
  assert.equal(fs.existsSync(f.output), false);
  const collected = spawnSync(process.execPath,
    [SCRIPT, 'collect', f.input, f.output, `v${VERSION}`], { encoding: 'utf8' });
  assert.equal(collected.status, 0, collected.stderr);
  assert.equal(yaml.load(fs.readFileSync(path.join(f.output, 'latest-mac.yml'), 'utf8')).files.length, 4);
  const retry = spawnSync(process.execPath,
    [SCRIPT, 'collect', f.input, f.output, VERSION], { encoding: 'utf8' });
  assert.equal(retry.status, 1);
  assert.match(retry.stderr, /refusing to overwrite/);
});

test('workflow validates actual builder output before each upload, including the ARM64 Linux channel', () => {
  const workflow = yaml.load(fs.readFileSync(path.join(__dirname, '../.github/workflows/build-release.yml'), 'utf8'));
  for (const [jobName, group] of [['build-macos', 'macos-${{ matrix.arch }}'],
    ['build-linux', 'linux-arm64'], ['build-windows', 'windows-x64']]) {
    const steps = workflow.jobs[jobName].steps;
    const validation = steps.findIndex((step) => step.run === `node desktop/scripts/release-artifacts.cjs validate ${group} desktop/dist`);
    const upload = steps.findIndex((step) => step.uses?.startsWith('actions/upload-artifact@'));
    assert.ok(validation >= 0 && validation < upload);
    assert.equal(steps[upload].with['if-no-files-found'], 'error');
    if (jobName === 'build-linux') {
      assert.match(steps[upload].with.path, /desktop\/dist\/latest-linux-arm64\.yml/);
      assert.doesNotMatch(steps[upload].with.path, /desktop\/dist\/latest-linux\.yml/);
    }
  }
});
