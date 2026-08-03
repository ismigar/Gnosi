const { execFileSync } = require('node:child_process');
const path = require('node:path');

/**
 * Seal unsigned macOS bundles so Gatekeeper does not report them as damaged.
 * A later electron-builder signing phase can replace this ad-hoc signature
 * when Developer ID credentials are available in CI.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
    { stdio: 'inherit' },
  );
  execFileSync(
    'codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', appPath],
    { stdio: 'inherit' },
  );
};
