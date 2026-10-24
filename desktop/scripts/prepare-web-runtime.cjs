/* Prepare the separately locked, host-native website builder before packaging. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../extensions/web-publishing/renderer');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const versions = { ...manifest.dependencies, ...manifest.devDependencies };
const binary = path.join(root, 'node_modules/node/bin', process.platform === 'win32' ? 'node.exe' : 'node');
const ready = fs.existsSync(binary) && Object.entries(versions).every(([name, version]) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version === version; }
  catch { return false; }
});
if (!ready) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['ci', '--prefix', root, '--no-audit', '--no-fund'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const probe = spawnSync(binary, ['-p', 'process.arch'], { encoding: 'utf8' });
if (probe.status !== 0 || probe.stdout.trim() !== process.arch) throw new Error('The website builder must match the desktop architecture');
console.log('Pinned website runtime is ready.');
