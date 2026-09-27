const { publicKey, default: prepareSparkle } = require('./scripts/sparkle-build.cjs');
const verifyFrontendAssets = require('./scripts/verify-frontend-assets.cjs');

async function beforePack(context) {
  await verifyFrontendAssets(context);
  prepareSparkle(context);
}

module.exports = {
  extends: './electron-builder.yml',
  beforePack,
  afterAllArtifactBuild: './scripts/sparkle-appcast.cjs',
  extraFiles: [{ from: 'native-build/Sparkle.framework', to: 'Frameworks/Sparkle.framework',
    filter: ['**/*', '!**/Headers/**', '!**/Modules/**'] }],
  extraResources: [{ from: 'native-build/gnosi-sparkle.dylib', to: 'gnosi-sparkle.dylib' },
    { from: 'native-build/LICENSE', to: 'Sparkle-LICENSE' }],
  mac: {
    identity: null,
    minimumSystemVersion: '12.0',
    extendInfo: {
      SUPublicEDKey: publicKey(),
      SUFeedURL: 'https://github.com/ismigar/Gnosi/releases/latest/download/appcast-${arch}.xml',
      SUEnableAutomaticChecks: false,
      SUAutomaticallyUpdate: false,
      SUAllowsAutomaticUpdates: false,
      SUSendProfileInfo: false,
      SURequireSignedFeed: true,
      SUSignedFeedFailureExpirationInterval: 0,
      SUVerifyUpdateBeforeExtraction: true,
    },
  },
};
