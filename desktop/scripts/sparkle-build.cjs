const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const VERSION = '2.9.4';
const SHA256 = 'ce89daf967db1e1893ed3ebd67575ed82d3902563e3191ca92aaec9164fbdef9';
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'native-build');
const archive = path.join(root, '.sparkle-sdk', `Sparkle-${VERSION}.tar.xz`);

function prepare({ download = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('Build the Sparkle bridge on macOS.');
  if (!fs.existsSync(archive) && download) {
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    execFileSync('/usr/bin/curl', ['--fail', '--location', '--silent', '--show-error',
      `https://github.com/sparkle-project/Sparkle/releases/download/${VERSION}/Sparkle-${VERSION}.tar.xz`, '-o', archive], { stdio: 'inherit' });
  }
  if (!fs.existsSync(archive)) throw new Error('Run pnpm --filter @gnosi/desktop install:sparkle to provision the pinned SDK before offline packaging.');
  if (createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== SHA256) throw new Error('Sparkle SDK checksum mismatch.');
  fs.mkdirSync(output, { recursive: true });
  // Always consume the verified upstream archive, not an unchecked cache stamp.
  execFileSync('/usr/bin/tar', ['-xf', archive, '-C', output], { stdio: 'inherit' });
  execFileSync('/usr/bin/xcrun', ['clang', '-dynamiclib', '-fobjc-arc', '-fblocks', '-Wall', '-Werror',
    '-Wno-unused-parameter', '-mmacosx-version-min=12.0', '-arch', 'arm64', '-arch', 'x86_64',
    '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'Sparkle', '-F', output,
    '-Wl,-rpath,@loader_path/../Frameworks', '-install_name', '@rpath/gnosi-sparkle.dylib',
    path.join(root, 'native/sparkle-bridge.m'), '-o', path.join(output, 'gnosi-sparkle.dylib')], { stdio: 'inherit' });
  return output;
}

function publicKey() {
  const { publicKey } = require('../sparkle-config.json');
  if (typeof publicKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(publicKey)
    || Buffer.from(publicKey, 'base64').length !== 32) throw new Error('Configure the genuine Sparkle public signing key before packaging.');
  return publicKey;
}

function beforePack(context) {
  publicKey();
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch];
  if (!arch) throw new Error('Build one supported macOS architecture at a time.');
  context.packager.platformSpecificBuildOptions.extendInfo.SUFeedURL =
    `https://github.com/ismigar/Gnosi/releases/latest/download/appcast-${arch}.xml`;
  prepare();
}
module.exports = { prepare, publicKey, VERSION, SHA256, output, archive, default: beforePack };
if (require.main === module) {
  try { prepare({ download: process.argv.includes('--download') }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
