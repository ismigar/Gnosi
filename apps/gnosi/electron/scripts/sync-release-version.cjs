#!/usr/bin/env node

const fs = require('node:fs');

const [, , releaseVersion, electronManifestPath, frontendManifestPath, lockfilePath] = process.argv;

if (!releaseVersion || !electronManifestPath || !frontendManifestPath || !lockfilePath) {
  console.error(
    'Usage: sync-release-version.cjs <version> <electron-package> <frontend-package> <lockfile>',
  );
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(releaseVersion)) {
  console.error(`Invalid release version: ${releaseVersion}`);
  process.exit(1);
}

function replaceAt(source, start, length, replacement) {
  return source.slice(0, start) + replacement + source.slice(start + length);
}

function updateManifest(manifestPath) {
  const source = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(source);

  if (typeof manifest.version !== 'string') {
    throw new Error(`Missing top-level version in ${manifestPath}`);
  }

  const versionToken = `"version": "${manifest.version}"`;
  const tokenIndex = source.indexOf(versionToken);
  const firstObjectEnd = source.indexOf('\n  "scripts"');
  if (tokenIndex === -1 || (firstObjectEnd !== -1 && tokenIndex > firstObjectEnd)) {
    throw new Error(`Cannot locate the top-level version token in ${manifestPath}`);
  }

  const nextSource = replaceAt(
    source,
    tokenIndex,
    versionToken.length,
    `"version": "${releaseVersion}"`,
  );
  if (nextSource !== source) {
    fs.writeFileSync(manifestPath, nextSource);
  }
}

function updateFrontendLockfile() {
  const source = fs.readFileSync(lockfilePath, 'utf8');
  const lockfile = JSON.parse(source);
  const workspaceVersion = lockfile.packages?.['apps/gnosi/frontend']?.version;

  if (typeof workspaceVersion !== 'string') {
    throw new Error(`Missing apps/gnosi/frontend version in ${lockfilePath}`);
  }

  const workspaceToken = '"apps/gnosi/frontend": {';
  const workspaceStart = source.indexOf(workspaceToken);
  const nextWorkspaceStart = source.indexOf('\n        "', workspaceStart + workspaceToken.length);
  const versionToken = `"version": "${workspaceVersion}"`;
  const versionIndex = source.indexOf(versionToken, workspaceStart);

  if (
    workspaceStart === -1 ||
    versionIndex === -1 ||
    (nextWorkspaceStart !== -1 && versionIndex > nextWorkspaceStart)
  ) {
    throw new Error(`Cannot locate the frontend workspace version token in ${lockfilePath}`);
  }

  const nextSource = replaceAt(
    source,
    versionIndex,
    versionToken.length,
    `"version": "${releaseVersion}"`,
  );
  if (nextSource !== source) {
    fs.writeFileSync(lockfilePath, nextSource);
  }
}

try {
  updateManifest(electronManifestPath);
  updateManifest(frontendManifestPath);
  updateFrontendLockfile();
  console.log(`Synchronized release version ${releaseVersion}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
