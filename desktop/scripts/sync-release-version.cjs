#!/usr/bin/env node

const fs = require('node:fs');

const [, , releaseVersion, rootManifest, desktopManifest, frontendManifest, pyprojectPath] =
  process.argv;

if (
  !releaseVersion ||
  !rootManifest ||
  !desktopManifest ||
  !frontendManifest ||
  !pyprojectPath
) {
  process.stderr.write(
    'Usage: sync-release-version.cjs <version> <root-package> <desktop-package> ' +
      '<frontend-package> <pyproject>\n',
  );
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(releaseVersion)) {
  process.stderr.write(`Invalid release version: ${releaseVersion}\n`);
  process.exit(1);
}

function updateManifest(manifestPath) {
  const source = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(source);
  if (typeof manifest.version !== 'string') {
    throw new Error(`Missing top-level version in ${manifestPath}`);
  }

  const versionToken = `"version": "${manifest.version}"`;
  const tokenIndex = source.indexOf(versionToken);
  if (tokenIndex === -1) {
    throw new Error(`Cannot locate the top-level version token in ${manifestPath}`);
  }

  fs.writeFileSync(
    manifestPath,
    source.slice(0, tokenIndex) +
      `"version": "${releaseVersion}"` +
      source.slice(tokenIndex + versionToken.length),
  );
}

function updatePyproject(projectPath) {
  const source = fs.readFileSync(projectPath, 'utf8');
  const projectBlock = source.match(/^\[project\]\n([\s\S]*?)(?=^\[|\Z)/m)?.[0];
  if (!projectBlock || !/^version = "[^"]+"$/m.test(projectBlock)) {
    throw new Error(`Cannot locate [project].version in ${projectPath}`);
  }

  const nextBlock = projectBlock.replace(
    /^version = "[^"]+"$/m,
    `version = "${releaseVersion}"`,
  );
  fs.writeFileSync(projectPath, source.replace(projectBlock, nextBlock));
}

try {
  for (const manifestPath of [rootManifest, desktopManifest, frontendManifest]) {
    updateManifest(manifestPath);
  }
  updatePyproject(pyprojectPath);
  process.stdout.write(`Synchronized release version ${releaseVersion}.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
