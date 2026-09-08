const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync, sign } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { generateFeed, verifyFeed, parseSignedFeed } = require('./scripts/sparkle-appcast.cjs');

for (const pairedTags of [false, true]) {
test(`archive and feed identities are verified with ${pairedTags ? 'paired' : 'self-closing'} enclosure tags`, async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gnosi-feed-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const keys=generateKeyPairSync('ed25519');
  const key=keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64');
  const archive=path.join(root,'Gnosi-3.0.1-arm64.zip'); fs.writeFileSync(archive,'synthetic update');
  const signer=args=>{
    const file=args.at(-1);
    if (file.endsWith('.xml') && pairedTags) {
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/(<enclosure\s[^>]+?)\s*\/>/, '$1></enclosure>'));
    }
    const bytes=fs.readFileSync(file), signature=sign(null,bytes,keys.privateKey).toString('base64');
    if(file.endsWith('.xml')) fs.appendFileSync(file,`<!-- sparkle-signatures:\nedSignature: ${signature}\nlength: ${bytes.length}\n-->\n`);
    return signature;
  };
  const file=await generateFeed(archive,{sign:signer,key});
  await verifyFeed(file,{version:'3.0.1',arch:'arm64',key});
  const xml=fs.readFileSync(file);
  assert.throws(()=>parseSignedFeed(Buffer.from(xml.toString().replace('Gnosi updates','other updates')),key),/signature/);
  const wrong=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64');
  assert.throws(()=>parseSignedFeed(xml,wrong),/signature/);
  await assert.rejects(generateFeed(archive,{sign:signer,key:wrong}),/signature/);
  fs.writeFileSync(file,xml); fs.appendFileSync(archive,'tampered');
  await assert.rejects(verifyFeed(file,{version:'3.0.1',arch:'arm64',key}),/match its update archive/);
});
}

const signingTool = path.join(__dirname, 'native-build/bin/sign_update');
test('the official Sparkle signing tool produces a feed accepted by the independent verifier', {
  skip: process.platform !== 'darwin' || !fs.existsSync(signingTool) ? 'Requires the provisioned macOS Sparkle SDK' : false,
}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-native-feed-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const keys = generateKeyPairSync('ed25519');
  const key = keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  const seed = path.join(root, 'ephemeral-test-key');
  fs.writeFileSync(seed, keys.privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32).toString('base64'), { mode: 0o600 });
  const archive = path.join(root, 'Gnosi-3.0.1-arm64.zip');
  fs.writeFileSync(archive, 'Isolated signing fixture');
  const nativeSign = args => execFileSync(signingTool, ['--ed-key-file', seed, ...args], { encoding: 'utf8', timeout: 30000 }).trim();
  const file = await generateFeed(archive, { sign: nativeSign, key });
  assert.match(fs.readFileSync(file, 'utf8'), /<\/enclosure>/);
  await verifyFeed(file, { version: '3.0.1', arch: 'arm64', key });
});

test('free macOS config retains native resources and disables Apple identity discovery', async () => {
  const {createRequire}=require('node:module');
  const fromBuilder=createRequire(require.resolve('electron-builder/package.json'));
  const {getConfig,validateConfiguration}=fromBuilder('app-builder-lib/out/util/config/config');
  const config=await getConfig(__dirname,'electron-builder.macos-sparkle.cjs');
  await validateConfiguration(config);
  assert.equal(config.mac.identity,null);
  assert.equal(config.mac.extendInfo.SURequireSignedFeed,true);
  assert.equal(config.mac.extendInfo.SUVerifyUpdateBeforeExtraction,true);
  assert.equal(config.mac.extendInfo.SUAutomaticallyUpdate,false);
  assert.ok(config.extraResources.some(entry=>entry.to==='python'));
  assert.ok(config.extraResources.some(entry=>entry.to==='gnosi-sparkle.dylib'));
  assert.ok(config.extraFiles.some(entry=>entry.to==='Frameworks/Sparkle.framework'));
});
