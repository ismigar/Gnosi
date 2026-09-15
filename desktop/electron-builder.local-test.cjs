// Local acceptance build: preserve Sparkle at runtime, but do not produce or
// publish an update feed under the already released 3.0.2 identity.
const base = require('./electron-builder.macos-sparkle.cjs');
module.exports = {
  ...base,
  artifactName: 'Gnosi-${version}-on-demand-${arch}.${ext}',
  npmRebuild: false,
  electronDist: require('node:path').join(require('node:path').dirname(require.resolve('electron/package.json')), 'dist'),
  afterAllArtifactBuild: async () => [],
  mac: { ...base.mac, artifactName: 'Gnosi-${version}-on-demand-${arch}.${ext}', target: [{ target: 'dmg', arch: ['arm64'] }] },
};
