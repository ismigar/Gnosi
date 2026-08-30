// Validate electron-builder output before upload and collect architecture-separated
// downloads. This tool only writes local files; it never publishes a release.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { isDeepStrictEqual } = require('node:util');

// Reuse the updater's locked parser without relying on pnpm hoisting or loading
// Electron. Collection requires the existing desktop dependencies to be present.
const updaterRequire = createRequire(require.resolve('electron-updater/package.json'));
const yaml = updaterRequire('js-yaml');
const semver = updaterRequire('semver');

// With the checked-in GitHub publish config, builder 26.15.3 uses latest even
// for RC versions: getResolvedPublishConfig does not assign the inferred channel
// for GitHub. GitHubProvider falls back from rc*.yml to these latest*.yml files.
// Do not invent/rename channels from semver without changing that publish config.
const GROUPS = Object.freeze({
  'macos-x64': { channel: 'latest-mac.yml', suffixes: ['x64.zip', 'x64.dmg'], updateSuffix: 'x64.zip' },
  'macos-arm64': { channel: 'latest-mac.yml', suffixes: ['arm64.zip', 'arm64.dmg'], updateSuffix: 'arm64.zip' },
  'linux-arm64': { channel: 'latest-linux-arm64.yml', suffixes: ['arm64.AppImage', 'arm64.deb'], updateSuffix: 'arm64.AppImage' },
  'windows-x64': { channel: 'latest.yml', suffixes: ['Setup.exe'], updateSuffix: 'Setup.exe' },
});
const MANIFEST_KEYS = new Set([
  'version', 'files', 'path', 'sha512', 'releaseDate', 'releaseName',
  'releaseNotes', 'stagingPercentage', 'minimumSystemVersion',
]);
const FILE_KEYS = new Set(['url', 'sha512', 'size', 'blockMapSize', 'isAdminRightsRequired']);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function safeName(name) {
  check(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name)
    && !name.includes('..') && !name.endsWith('.')
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name),
  `Unsafe artifact path: ${String(name)}`);
  return name;
}

function checkVersion(version) {
  check(typeof version === 'string' && semver.valid(version) === version,
    `Invalid release version: ${String(version)}`);
  return version;
}

async function directoryWithoutLinks(directory) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fsp.lstat(current);
    check(stat.isDirectory() && !stat.isSymbolicLink(), `Unsafe directory: ${current}`);
  }
  return absolute;
}

async function digestFile(file) {
  const stat = await fsp.lstat(file);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0,
    `Missing, empty or unsafe artifact: ${file}`);
  const hash = createHash('sha512');
  let size = 0;
  for await (const chunk of fs.createReadStream(file)) {
    hash.update(chunk);
    size += chunk.length;
  }
  check(size === stat.size, `Artifact changed while reading: ${file}`);
  return { sha512: hash.digest('base64'), size };
}

async function inventory(directory, group, buildOutput) {
  const config = GROUPS[group];
  check(config, `Unsupported artifact group: ${group}`);
  await directoryWithoutLinks(directory);
  const result = new Map();
  const folded = new Set();
  for (const name of (await fsp.readdir(directory)).sort()) {
    // dist also contains unpacked apps and builder diagnostics. Uploaded groups
    // must contain only release assets; build validation ignores unrelated files.
    if (buildOutput && !/\.(?:dmg|zip|AppImage|deb|exe|blockmap)$/i.test(name)
      && !/^(?:latest|alpha|beta).*\.yml$/i.test(name)) continue;
    safeName(name);
    check(!folded.has(name.toLowerCase()), `Artifact name collision: ${name}`);
    folded.add(name.toLowerCase());
    const file = path.join(directory, name);
    const stat = await fsp.lstat(file);
    check(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0,
      `Missing, empty or unsafe artifact: ${file}`);
    result.set(name, { file, size: stat.size });
  }
  check(result.has(config.channel), `Missing required channel: ${group}/${config.channel}`);
  return result;
}

function knownKeys(value, keys, label) {
  check(value && typeof value === 'object' && !Array.isArray(value), `Invalid ${label}`);
  for (const key of Object.keys(value)) {
    check(keys.has(key), `Unsupported ${label} field: ${key}`);
  }
}

async function validateInventory(group, entries, version) {
  const config = GROUPS[group];
  const channel = entries.get(config.channel);
  check(channel.size <= 1024 * 1024, `Oversized manifest: ${channel.file}`);
  const raw = await fsp.readFile(channel.file);
  check(raw.length === channel.size, `Manifest changed while reading: ${channel.file}`);
  const manifest = yaml.load(raw.toString('utf8'), { schema: yaml.JSON_SCHEMA });
  // Later copies must match the exact manifest bytes that were validated.
  Object.assign(channel, { sha512: createHash('sha512').update(raw).digest('base64') });
  knownKeys(manifest, MANIFEST_KEYS, 'manifest');
  checkVersion(manifest.version);
  check(manifest.version === version, `Version mismatch in ${group}: expected ${version}`);
  check(typeof manifest.releaseDate === 'string' && Number.isFinite(Date.parse(manifest.releaseDate)),
    `Invalid releaseDate in ${group}`);
  check(Array.isArray(manifest.files) && manifest.files.length > 0, `Missing files in ${group}`);
  const required = config.suffixes.map((suffix) => `Gnosi-${version}-${suffix}`);
  const allowed = new Set([config.channel, ...required, ...required.map((name) => `${name}.blockmap`)]);
  for (const name of entries.keys()) {
    check(allowed.has(name), `Unexpected artifact in ${group}: ${name}`);
    if (name.endsWith('.blockmap')) {
      check(entries.has(name.slice(0, -9)), `Orphan blockmap: ${name}`);
    }
  }
  const referenced = new Set();
  for (const info of manifest.files) {
    knownKeys(info, FILE_KEYS, 'file');
    const name = safeName(info.url);
    check(!referenced.has(name), `Duplicate artifact reference in ${group}: ${name}`);
    referenced.add(name);
    check(required.includes(name), `Wrong architecture or artifact in ${group}: ${name}`);
    check(entries.has(name), `Missing referenced artifact in ${group}: ${name}`);
    const entry = entries.get(name);
    const actual = await digestFile(entry.file);
    check(info.sha512 === actual.sha512, `SHA-512 mismatch in ${group}: ${name}`);
    // Some builder targets omit size; if supplied it must describe actual bytes.
    if (info.size !== undefined) {
      check(Number.isSafeInteger(info.size) && info.size === actual.size,
        `Size mismatch in ${group}: ${name}`);
    }
    if (info.blockMapSize !== undefined) {
      check(Number.isSafeInteger(info.blockMapSize) && info.blockMapSize > 0
        && info.blockMapSize < actual.size, `Invalid blockMapSize: ${name}`);
    }
    Object.assign(entry, actual);
  }
  for (const name of required) {
    check(entries.has(name), `Missing required artifact in ${group}: ${name}`);
  }
  // Installer presence and updater references are separate requirements. DMG
  // writeUpdateInfo is optional; FPM adds DEB metadata only with publishConfig.
  // Verify every listed hash, but never fabricate entries for unlisted installers.
  const updateArtifact = `Gnosi-${version}-${config.updateSuffix}`;
  check(referenced.has(updateArtifact), `Missing updater reference in ${group}: ${updateArtifact}`);
  const legacy = manifest.files.find((info) => info.url === safeName(manifest.path));
  check(legacy && manifest.sha512 === legacy.sha512, `Invalid legacy path/sha512 in ${group}`);
  if (group.startsWith('macos-')) {
    check(manifest.path === required[0], `macOS legacy path must reference its ZIP in ${group}`);
  }
  // Hash unlisted installers and sidecars as well, to verify copied bytes without
  // pretending that the updater supplied a checksum for an unlisted installer.
  for (const entry of entries.values()) {
    if (!entry.sha512) Object.assign(entry, await digestFile(entry.file));
  }
  return manifest;
}

async function validateBuild(group, directory, version) {
  checkVersion(version);
  return validateInventory(group, await inventory(directory, group, true), version);
}

function mergeMacManifests(x64, arm64) {
  const metadata = (manifest) => Object.fromEntries(Object.entries(manifest)
    .filter(([key]) => !['files', 'path', 'sha512', 'releaseDate'].includes(key)));
  check(isDeepStrictEqual(metadata(x64), metadata(arm64)), 'Conflicting macOS release metadata');
  // Match builder ordering: ZIPs first, x64 before ARM64; legacy fields select
  // the x64 ZIP, while modern updaters select from both architectures in files.
  const files = [...x64.files, ...arm64.files].sort((a, b) => {
    const rank = (info) => (info.url.endsWith('.zip') ? 0 : 2)
      + (info.url.includes('-arm64.') ? 1 : 0);
    return rank(a) - rank(b);
  });
  return {
    ...x64,
    files,
    path: files[0].url,
    sha512: files[0].sha512,
    releaseDate: Date.parse(x64.releaseDate) >= Date.parse(arm64.releaseDate)
      ? x64.releaseDate : arm64.releaseDate,
  };
}

async function collectArtifacts(inputDirectory, outputDirectory, version) {
  checkVersion(version);
  const input = await directoryWithoutLinks(inputDirectory);
  const output = path.resolve(outputDirectory);
  await directoryWithoutLinks(path.dirname(output));
  check(output !== input && !output.startsWith(`${input}${path.sep}`)
    && !input.startsWith(`${output}${path.sep}`), 'Input and output directories must be separate');
  check(!fs.existsSync(output), `Output already exists; refusing to overwrite: ${output}`);
  const groupNames = (await fsp.readdir(input)).sort();
  check(isDeepStrictEqual(groupNames, Object.keys(GROUPS).sort()),
    'Expected exactly macos-x64, macos-arm64, linux-arm64 and windows-x64 groups');
  const inventories = new Map();
  const copies = new Map();
  const folded = new Set(['latest-mac.yml']);
  for (const group of Object.keys(GROUPS)) {
    const entries = await inventory(path.join(input, group), group, false);
    inventories.set(group, entries);
    for (const [name, entry] of entries) {
      if (group.startsWith('macos-') && name === 'latest-mac.yml') continue;
      check(!folded.has(name.toLowerCase()), `Artifact name collision: ${name}`);
      folded.add(name.toLowerCase());
      copies.set(name, entry);
    }
  }
  const manifests = new Map();
  for (const [group, entries] of inventories) {
    manifests.set(group, await validateInventory(group, entries, version));
  }
  const merged = mergeMacManifests(manifests.get('macos-x64'), manifests.get('macos-arm64'));
  // Use the builder's default dump schema: it quotes ISO date strings. A JSON
  // schema dump leaves them unquoted and the updater reads them as Date objects.
  const mergedYaml = yaml.dump(merged, { noRefs: true, lineWidth: -1 });
  // No output is created until every architecture, reference and hash passes.
  // mkdir and exclusive copies also reject existing destinations on a retry.
  await fsp.mkdir(output);
  for (const [name, entry] of copies) {
    const destination = path.join(output, name);
    await fsp.copyFile(entry.file, destination, fs.constants.COPYFILE_EXCL);
    const actual = await digestFile(destination);
    check(actual.sha512 === entry.sha512 && actual.size === entry.size,
      `Artifact changed during collection: ${name}`);
  }
  // Write the aggregate last, after verifying all copied artifacts too.
  await fsp.writeFile(path.join(output, 'latest-mac.yml'), mergedYaml, { flag: 'wx' });
  return merged;
}

async function main(args) {
  const packageVersion = require('../package.json').version;
  if (args.length === 3 && args[0] === 'validate') {
    await validateBuild(args[1], args[2], packageVersion);
  } else if (args.length === 4 && args[0] === 'collect') {
    const version = args[3].replace(/^v/, '');
    check(version === packageVersion, 'Release tag does not match desktop/package.json');
    await collectArtifacts(args[1], args[2], version);
  } else {
    throw new Error('Usage: release-artifacts.cjs validate <group> <dist> | collect <input> <new-output> <tag>');
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Release artifact validation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { collectArtifacts, validateBuild };
