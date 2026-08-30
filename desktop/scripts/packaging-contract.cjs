const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const REQUIRED_RUNTIME_FILES = Object.freeze([
  'main.js',
  'preload.js',
  'ipc-security.js',
  'profile-startup.js',
  'cookie-schema-guard.js',
  'cookie-schema.js',
  'cookie-profile-migration.js',
  'cookie-migration.js',
  'cookie-migration-files.js',
  'cookie-rollback.js',
  'profile-preservation.js',
  'exclusive-rename.js',
  'application-menu.js',
  'backend-launch.js',
  'update-policy.js',
]);

function normalizeAsarEntry(entry) {
  return entry.replaceAll('\\', '/').replace(/^\/+/, '');
}

function assertPackagedRuntimeEntries(entries, requiredFiles = REQUIRED_RUNTIME_FILES) {
  const packagedEntries = new Set(entries.map(normalizeAsarEntry));
  const missingFiles = requiredFiles.filter((file) => !packagedEntries.has(file));

  if (missingFiles.length > 0) {
    throw new Error(
      `Packaged app is missing required runtime files: ${missingFiles.join(', ')}`,
    );
  }
}

function getResourcesDirectory(context) {
  if (context.electronPlatformName === 'darwin') {
    const productFilename = context.packager.appInfo.productFilename;
    return path.join(context.appOutDir, `${productFilename}.app`, 'Contents', 'Resources');
  }

  return path.join(context.appOutDir, 'resources');
}

function verifyPackagedRuntime(context, listPackage = asar.listPackage) {
  const asarPath = path.join(getResourcesDirectory(context), 'app.asar');
  if (!fs.existsSync(asarPath)) {
    throw new Error(`Packaged runtime archive does not exist: ${asarPath}`);
  }

  assertPackagedRuntimeEntries(listPackage(asarPath));
  console.log(`Verified packaged Electron runtime: ${asarPath}`);
}

module.exports = {
  REQUIRED_RUNTIME_FILES,
  assertPackagedRuntimeEntries,
  getResourcesDirectory,
  normalizeAsarEntry,
  verifyPackagedRuntime,
};
