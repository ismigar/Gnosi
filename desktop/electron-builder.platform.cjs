module.exports = process.platform === 'darwin'
  ? require('./electron-builder.macos-sparkle.cjs')
  : { extends: './electron-builder.yml' };
