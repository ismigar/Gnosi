const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function build(outputDirectory) {
  if (process.platform !== 'darwin') throw new Error('Build file coordination on macOS.');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const output = path.join(outputDirectory, 'gnosi-file-access');
  execFileSync('/usr/bin/xcrun', ['clang', '-fobjc-arc', '-fblocks', '-Wall', '-Werror',
    '-mmacosx-version-min=12.0', '-arch', 'arm64', '-arch', 'x86_64',
    '-framework', 'Foundation', path.resolve(__dirname, '../native/file-access.m'),
    '-o', output], { stdio: 'inherit' });
  return output;
}

module.exports = { build };
if (require.main === module) {
  build(path.resolve(__dirname, '../native-build'));
}
