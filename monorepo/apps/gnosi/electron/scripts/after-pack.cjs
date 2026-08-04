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
 * or framework"). Signing `Versions/Current` inside each framework resolves it:
 * that sub-bundle has an unambiguous type, and its signature propagates to the
 * framework root for verification purposes.
 */
function signAdHoc(target) {
  execFileSync(
    'codesign',
    ['--force', '--sign', '-', '--timestamp=none', target],
    { stdio: 'inherit' },
  );
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  // Sign each embedded framework via its Versions/Current sub-bundle, which
  // has an unambiguous bundle type. Covers Electron's Contents/Frameworks and
  // PyInstaller's Python bundle nested under Contents/Resources/python/_internal.
  const frameworkRoots = [
    path.join(appPath, 'Contents', 'Frameworks'),
    path.join(appPath, 'Contents', 'Resources', 'python', '_internal'),
  ];
  for (const root of frameworkRoots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      if (!entry.endsWith('.framework')) continue;
      const current = path.join(root, entry, 'Versions', 'Current');
      signAdHoc(fs.existsSync(current) ? current : path.join(root, entry));
    }
  }

  // Seal the outer .app ad-hoc (no --deep: nested frameworks are already signed).
  signAdHoc(appPath);

  execFileSync(
    'codesign',
    ['--verify', '--strict', '--verbose=2', appPath],
    { stdio: 'inherit' },
  );
};


