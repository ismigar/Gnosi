// electron-builder 26.x configuration. The base config remains usable for
// local ad-hoc packages; the release entry point must never silently use it.
module.exports = {
  extends: './electron-builder.yml',
  forceCodeSigning: true,
  beforePack: './scripts/macos-signing-preflight.cjs',
  afterSign: './scripts/verify-macos-release.cjs',
  mac: {
    type: 'distribution',
    identity: process.env.CSC_NAME || (process.env.APPLE_TEAM_ID ? `(${process.env.APPLE_TEAM_ID})` : undefined),
    hardenedRuntime: true,
    sign: './scripts/sign-macos-release.cjs',
    // Arrays are merged with the base config; null clears its ad-hoc exclusions.
    signIgnore: null,
    entitlements: 'assets/entitlements.mac.plist',
    entitlementsInherit: 'assets/entitlements.mac.plist',
    notarize: true,
  },
  dmg: { sign: true },
};
