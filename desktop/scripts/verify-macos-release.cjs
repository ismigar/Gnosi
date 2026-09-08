const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const { collectCode, isConcreteFrameworkVersion } = require('./after-pack.cjs');

function validateSignature(details, team) {
  if (!/^[A-Z0-9]{10}$/.test(team || '')
    || !/^Authority=Developer ID Application: .+$/m.test(details)
    || !details.split(/\r?\n/).includes(`TeamIdentifier=${team}`)
    || !/^Timestamp=.+$/m.test(details)
    || !/^CodeDirectory .*flags=.*\bruntime\b/m.test(details)
    || /^Signature=adhoc$/m.test(details)) {
    throw new Error('The macOS release must use the expected Developer ID team, a secure timestamp and hardened runtime.');
  }
}

function verifyRelease(context, { environment = process.env, run = execFileSync, spawn = spawnSync, collect = collectCode } = {}) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });
  const { files, directories } = collect(appPath);
  const targets = new Set([appPath, ...files, ...directories.filter(directory =>
    directory.endsWith('.app') || directory.endsWith('.xpc') || isConcreteFrameworkVersion(directory))]);
  for (const target of targets) {
    const result = spawn('/usr/bin/codesign', ['--display', '--verbose=4', target], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('A bundled code signature could not be read.');
    validateSignature(result.stderr, environment.APPLE_TEAM_ID);
  }
  run('/usr/bin/xcrun', ['stapler', 'validate', appPath], { stdio: 'inherit' });
  run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath], { stdio: 'inherit' });
}

module.exports = { validateSignature, verifyRelease, default: context => verifyRelease(context) };
