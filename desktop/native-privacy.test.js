const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const descriptions = require('./assets/native-privacy.json');
const { installNativePrivacy, mergePrivacyStrings } = require('./scripts/native-privacy.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-native-privacy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'Gnosi.app');
}

test('installs four localized privacy descriptions, preserving unrelated keys and comments', (t) => {
  const app = fixture(t);
  const en = path.join(app, 'Contents/Resources/en.lproj/InfoPlist.strings');
  fs.mkdirSync(path.dirname(en), { recursive: true });
  fs.writeFileSync(en, '/* Keep the application label. */\n"CFBundleDisplayName" = "Existing name";\n"NSMicrophoneUsageDescription" = "Old generic description";\n');
  const ca = path.join(app, 'Contents/Resources/ca.lproj/InfoPlist.strings');
  fs.mkdirSync(path.dirname(ca), { recursive: true });
  fs.writeFileSync(ca, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('"ExistingKey" = "Valor amb accents: à é";\n', 'utf16le')]));
  installNativePrivacy(app);
  assert.deepEqual(Object.keys(descriptions).sort(), ['ca', 'en', 'es', 'fr']);
  for (const [language, values] of Object.entries(descriptions)) {
    const source = fs.readFileSync(path.join(app, `Contents/Resources/${language}.lproj/InfoPlist.strings`), 'utf8');
    for (const [key, value] of Object.entries(values)) {
      assert.ok(source.includes(`${JSON.stringify(key)} = ${JSON.stringify(value)};`));
      assert.equal(source.split(`${JSON.stringify(key)} = `).length - 1, 1);
    }
  }
  const source = fs.readFileSync(en, 'utf8');
  assert.match(source, /"CFBundleDisplayName" = "Existing name";/);
  assert.match(source, /Keep the application label/);
  assert.doesNotMatch(source, /Old generic description/);
  assert.match(fs.readFileSync(ca, 'utf8'), /Valor amb accents: à é/);
  installNativePrivacy(app);
  assert.equal(fs.readFileSync(en, 'utf8'), source);
});

test('comments mentioning a privacy key do not suppress its actual declaration', () => {
  const source = '/* "NSAppleEventsUsageDescription" = "Example"; */\n// Keep this comment\n';
  const merged = mergePrivacyStrings(source, descriptions.en);
  assert.ok(merged.includes('/* "NSAppleEventsUsageDescription" = "Example"; */'));
  assert.ok(merged.includes(`"NSAppleEventsUsageDescription" = ${JSON.stringify(descriptions.en.NSAppleEventsUsageDescription)};`));
});

test('base packaging declares English purposes and retains the native workspace runtime', () => {
  const config = fs.readFileSync(path.join(__dirname, 'electron-builder.yml'), 'utf8');
  assert.match(config, /^  - agent-workspace.js$/m);
  for (const [key, value] of Object.entries(descriptions.en)) assert.ok(config.includes(`    ${key}: ${value}`));
});

test('actual afterPack installs the locale resources before signing the bundle', async (t) => {
  const app = fixture(t);
  fs.mkdirSync(path.join(app, 'Contents/Resources'), { recursive: true });
  const events = [];
  const exported = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'scripts/after-pack.cjs'), 'utf8'), {
    exports: exported, Buffer,
    require(name) {
      if (name === './packaging-contract.cjs') return { verifyPackagedRuntime() {}, verifyPackagedBackendResources() {} };
      if (name === './file-access-build.cjs') return { build() { events.push('native-build'); } };
      if (name === './native-privacy.cjs') return { installNativePrivacy(target) { events.push('privacy'); installNativePrivacy(target); } };
      if (name === 'node:child_process') return { execFileSync(command, args) {
        events.push(args.includes('--verify') ? 'verify' : 'sign');
        assert.equal(command, 'codesign');
        for (const language of Object.keys(descriptions)) assert.ok(fs.existsSync(path.join(app, `Contents/Resources/${language}.lproj/InfoPlist.strings`)));
      } };
      return require(name);
    },
  });
  await exported.default({ electronPlatformName: 'darwin', appOutDir: path.dirname(app), packager: { appInfo: { productFilename: 'Gnosi' } } });
  assert.deepEqual(events, ['privacy', 'native-build', 'sign', 'verify']);
});

test('accepts unquoted existing privacy keys without adding duplicate declarations', () => {
  const merged = mergePrivacyStrings('NSMicrophoneUsageDescription = "Old";\n', descriptions.en);
  assert.equal(merged.match(/NSMicrophoneUsageDescription/g).length, 1);
  assert.ok(merged.includes(JSON.stringify(descriptions.en.NSMicrophoneUsageDescription)));
});

test('macOS accepts generated strings and preserves existing binary-plist values', { skip: process.platform !== 'darwin' }, (t) => {
  const app = fixture(t);
  const file = path.join(app, 'Contents/Resources/en.lproj/InfoPlist.strings');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '"CFBundleDisplayName" = "Existing binary name";\n');
  execFileSync('/usr/bin/plutil', ['-convert', 'binary1', file]);
  installNativePrivacy(app);
  for (const language of Object.keys(descriptions)) {
    execFileSync('/usr/bin/plutil', ['-lint', path.join(app, `Contents/Resources/${language}.lproj/InfoPlist.strings`)]);
  }
  assert.match(fs.readFileSync(file, 'utf8'), /Existing binary name/);
});
