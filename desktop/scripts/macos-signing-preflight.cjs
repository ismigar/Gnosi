const { execFileSync } = require('node:child_process');

function validateEnvironment(environment) {
  if (!/^[A-Z0-9]{10}$/.test(environment.APPLE_TEAM_ID || '')) {
    throw new Error('Set APPLE_TEAM_ID to the distribution team identifier.');
  }
  const hasKeychain = Boolean(environment.APPLE_KEYCHAIN_PROFILE);
  const hasApiKey = Boolean(environment.APPLE_API_KEY && environment.APPLE_API_KEY_ID && environment.APPLE_API_ISSUER);
  const hasPassword = Boolean(environment.APPLE_ID && environment.APPLE_APP_SPECIFIC_PASSWORD);
  if (!hasKeychain && !hasApiKey && !hasPassword) {
    throw new Error('Configure notarization with APPLE_KEYCHAIN_PROFILE, an App Store Connect API key, or an app-specific password. Do not put credentials in source files.');
  }
  // electron-builder 26 checks Apple ID first, then API credentials, then Keychain.
  // Reject incomplete earlier strategies instead of unexpectedly shadowing a profile.
  if ((environment.APPLE_ID || environment.APPLE_APP_SPECIFIC_PASSWORD) && !hasPassword) {
    throw new Error('APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD must both be configured.');
  }
  if (!hasPassword && (environment.APPLE_API_KEY || environment.APPLE_API_KEY_ID || environment.APPLE_API_ISSUER) && !hasApiKey) {
    throw new Error('APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER must all be configured.');
  }
  if (environment.CSC_IDENTITY_AUTO_DISCOVERY === 'false' && !environment.CSC_LINK) {
    throw new Error('Enable certificate discovery or provide CSC_LINK for a signed macOS release.');
  }
}

function checkSigning({ environment = process.env, platform = process.platform, run = execFileSync } = {}) {
  if (platform !== 'darwin') throw new Error('Build signed macOS releases on macOS.');
  validateEnvironment(environment);
  run('/usr/bin/xcrun', ['--find', 'notarytool'], { stdio: 'pipe' });
  run('/usr/bin/xcrun', ['--find', 'stapler'], { stdio: 'pipe' });
  // electron-builder imports CSC_LINK into its temporary keychain after this
  // hook. Existing Keychain identities can be checked before any packaging IO.
  if (!environment.CSC_LINK) {
    const identities = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
    const team = environment.APPLE_TEAM_ID;
    const names = [...identities.matchAll(/"(Developer ID Application: [^"\r\n]+)"/g)].map(match => match[1]);
    const selected = names.filter(name => name.endsWith(`(${team})`)
      && (!environment.CSC_NAME || name.includes(environment.CSC_NAME)));
    if (selected.length !== 1) {
      throw new Error('Select one valid Developer ID Application identity for APPLE_TEAM_ID (use CSC_NAME when needed). Apple Development and ad-hoc identities cannot be used.');
    }
  }
}

module.exports = { validateEnvironment, checkSigning, default: () => checkSigning() };
if (require.main === module) {
  try {
    checkSigning();
    console.log('macOS distribution signing prerequisites are available.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
