const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Seal unsigned macOS bundles so Gatekeeper does not report them as damaged.
 * A later electron-builder signing phase can replace this ad-hoc signature
 * when Developer ID credentials are available in CI.
 *
 * The PyInstaller-bundled Python ships as a macOS "framework" whose top-level
 * bundle is ambiguous to `codesign` ("bundle format is ambiguous: could be app
 * or framework"). Sign every Mach-O file first, then nested app/XPC bundles and
 * concrete framework versions from deepest to shallowest. This satisfies the
 * nested-code requirements without signing framework symlinks or ambiguous
 * framework roots.
 */
function signAdHoc(target) {
  execFileSync(
    'codesign',
    ['--force', '--sign', '-', '--timestamp=none', target],
    { stdio: 'inherit' },
  );
}

const MACH_O_MAGICS = new Set([
  0xfeedface,
  0xfeedfacf,
  0xcefaedfe,
  0xcffaedfe,
  0xcafebabe,
  0xbebafeca,
  0xcafebabf,
  0xbfbafeca,
]);

function isMachO(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(4);
    if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length) return false;
    return MACH_O_MAGICS.has(header.readUInt32BE(0));
  } finally {
    fs.closeSync(descriptor);
  }
}

function isFrameworkAliasPath(target) {
  const segments = target.split(path.sep);
  const frameworkIndex = segments.findLastIndex((segment) => segment.endsWith('.framework'));
  if (frameworkIndex === -1) return false;
  const relative = segments.slice(frameworkIndex + 1);
  if (relative.length === 0) return false;
  if (relative[0] !== 'Versions') return true;
  if (relative.length === 1) return false;
  return relative[1] === 'Current';
}

function collectCode(root) {
  const files = [];
  const directories = [];
  const visit = (current) => {
    if (isFrameworkAliasPath(current)) return;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      if (isMachO(current)) files.push(current);
      return;
    }
    if (!stat.isDirectory()) return;
    directories.push(current);
    for (const entry of fs.readdirSync(current)) visit(path.join(current, entry));
  };
  visit(root);
  return { files, directories };
}

function isConcreteFrameworkVersion(directory) {
  const parent = path.dirname(directory);
  const frameworkRoot = path.dirname(parent);
  return path.basename(parent) === 'Versions'
    && path.basename(frameworkRoot).endsWith('.framework')
    && path.basename(directory) !== 'Current'
    && fs.existsSync(path.join(directory, 'Resources', 'Info.plist'));
}

function depth(target) {
  return target.split(path.sep).length;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  const { files, directories } = collectCode(appPath);
  files.sort((left, right) => depth(right) - depth(left)).forEach(signAdHoc);

  directories
    .filter((directory) => directory !== appPath && (
      directory.endsWith('.app')
      || directory.endsWith('.xpc')
      || isConcreteFrameworkVersion(directory)
    ))
    .sort((left, right) => depth(right) - depth(left))
    .forEach(signAdHoc);

  // Seal the outer .app after every nested code object has its own signature.
  signAdHoc(appPath);

  execFileSync(
    'codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', appPath],
    { stdio: 'inherit' },
  );
};
