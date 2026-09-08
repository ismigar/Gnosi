const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { collectCode, isConcreteFrameworkVersion, depth } = require('./after-pack.cjs');

function signRelease(options, { run = execFileSync, collect = collectCode } = {}) {
  if (options.platform !== 'darwin' || options.type !== 'distribution'
    || !options.identity || options.identity === '-') {
    throw new Error('A macOS release requires a distribution signing identity.');
  }
  const appPath = path.resolve(options.app);
  const entitlements = path.resolve(__dirname, '../assets/entitlements.mac.plist');
  const { files, directories } = collect(appPath);
  const backendPath = path.join(appPath, 'Contents/Resources/python/cervell_backend');
  if (!files.includes(backendPath)) throw new Error('Cannot sign a release without its native backend.');
  const sign = (target, executableBundle = false) => {
    const args = ['--force', '--sign', options.identity, '--timestamp', '--options', 'runtime'];
    if (options.keychain) args.push('--keychain', options.keychain);
    if (executableBundle || target === backendPath) args.push('--entitlements', entitlements);
    args.push(target);
    run('/usr/bin/codesign', args, { stdio: 'inherit' });
  };
  // Re-sign every Mach-O, including Python extensions and native Node modules.
  // A skipped ad-hoc Python framework would fail Apple's notarization checks.
  files.sort((a, b) => depth(b) - depth(a)).forEach(file => sign(file));
  directories.filter(directory => directory !== appPath && (
    directory.endsWith('.app') || directory.endsWith('.xpc') || isConcreteFrameworkVersion(directory)
  )).sort((a, b) => depth(b) - depth(a)).forEach(directory => sign(directory, !isConcreteFrameworkVersion(directory)));
  sign(appPath, true);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });
}

module.exports = { signRelease, default: options => signRelease(options) };
