const fs = require('node:fs');
const path = require('node:path');
const { createHash, createPublicKey, verify } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { isCanonicalReleaseVersion } = require('../release-version');
const config = require('../sparkle-config.json');
const { output } = require('./sparkle-build.cjs');

const BASE = 'https://github.com/ismigar/Gnosi/releases/download';
const fail = message => { throw new Error(message); };
const publicKey = value => createPublicKey({ key: Buffer.concat([
  Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(value, 'base64'),
]), type: 'spki', format: 'der' });

async function hash(file) {
  const digest = createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('base64');
}

function parseSignedFeed(bytes, key = config.publicKey) {
  if (bytes.length > 1024 * 1024) fail('Oversized Sparkle feed.');
  const match = /<!-- sparkle-signatures:\nedSignature: ([A-Za-z0-9+/]{86}==)\nlength: ([0-9]+)\n-->\s*$/.exec(bytes.toString('utf8'));
  if (!match) fail('Missing Sparkle feed signature.');
  const length = Number(match[2]);
  if (length !== Buffer.byteLength(bytes.toString('utf8').slice(0, match.index))
    || !verify(null, bytes.subarray(0, length), publicKey(key), Buffer.from(match[1], 'base64'))) fail('Invalid Sparkle feed signature.');
  return bytes.subarray(0, length).toString('utf8');
}

async function verifyFeed(file, { version, arch, key = config.publicKey } = {}) {
  if (!['arm64', 'x64'].includes(arch) || !isCanonicalReleaseVersion(version)) fail('Invalid Sparkle artifact identity.');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('Unsafe Sparkle feed.');
  if (stat.size > 1024 * 1024) fail('Oversized Sparkle feed.');
  const xml = parseSignedFeed(fs.readFileSync(file), key);
  if ((xml.match(/<item>/g) || []).length !== 1 || (xml.match(/<enclosure\s/g) || []).length !== 1) fail('Expected one complete Sparkle update.');
  const name = `Gnosi-${version}-${arch}.zip`;
  // Apple's XML serializer in sign_update expands empty elements to paired
  // tags. Both forms describe the same enclosure after signature validation.
  const enclosure = /<enclosure\s+([^>]+?)(?:\s*\/>|\s*>\s*<\/enclosure>)/.exec(xml)?.[1] || '';
  const attribute = name => new RegExp(`(?:^|\\s)${name}="([^"]+)"`).exec(enclosure)?.[1];
  const archive = path.join(path.dirname(file), name);
  const archiveStat = fs.lstatSync(archive);
  if (!archiveStat.isFile() || archiveStat.isSymbolicLink()
    || attribute('url') !== `${BASE}/v${version}/${name}`
    || Number(attribute('length')) !== archiveStat.size
    || attribute('gnosi:sha512') !== await hash(archive)
    || !/^[A-Za-z0-9+/]{86}==$/.test(attribute('sparkle:edSignature') || '')
    || !xml.includes(`<sparkle:version>${version}</sparkle:version>`)) fail('Sparkle feed does not match its update archive.');
  return true;
}

function signer(args, { environment = process.env, run = execFileSync } = {}) {
  const credentialArgs = environment.GNOSI_SPARKLE_PRIVATE_KEY
    ? ['--ed-key-file', '-'] : ['--account', config.keychainAccount];
  return run(path.join(output, 'bin/sign_update'), [...credentialArgs, ...args], {
    encoding: 'utf8', input: environment.GNOSI_SPARKLE_PRIVATE_KEY,
    // Never print the signing secret, including in an error's command text.
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

async function generateFeed(archive, { sign = signer, key = config.publicKey } = {}) {
  const name = path.basename(archive);
  const identity = /^Gnosi-(.+)-(arm64|x64)\.zip$/.exec(name);
  if (!identity || !isCanonicalReleaseVersion(identity[1])) fail('Invalid Sparkle archive filename.');
  const [, version, arch] = identity;
  const file = path.join(path.dirname(archive), `appcast-${arch}.xml`);
  const signature = sign(['-p', archive]);
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signature)) fail('Signing tool returned an invalid archive signature.');
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" xmlns:gnosi="https://ismigar.github.io/gnosi/updates"><channel><title>Gnosi</title><link>https://ismigar.github.io/changelog.html</link><description>Gnosi updates</description><item><title>Gnosi ${version}</title><sparkle:version>${version}</sparkle:version><sparkle:shortVersionString>${version}</sparkle:shortVersionString><sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion><enclosure url="${BASE}/v${version}/${name}" length="${fs.statSync(archive).size}" type="application/octet-stream" sparkle:edSignature="${signature}" gnosi:sha512="${await hash(archive)}" /></item></channel></rss>\n`;
  fs.writeFileSync(file, xml);
  sign([file]);
  // This independently checks the pinned public key: using a different local
  // Keychain account or CI secret must stop packaging, even if signing succeeds.
  await verifyFeed(file, { version, arch, key });
  return file;
}

async function afterArtifacts(context) {
  const archives = context.artifactPaths.filter(file => /^Gnosi-.+-(arm64|x64)\.zip$/.test(path.basename(file)));
  if (!archives.length) fail('A Sparkle release requires a macOS ZIP update.');
  const feeds = [];
  for (const archive of archives) feeds.push(await generateFeed(archive));
  return feeds;
}

module.exports = { parseSignedFeed, verifyFeed, generateFeed, signer, publicKey, hash, default: afterArtifacts };
if (require.main === module) {
  (async () => {
    const [command, directory, version, arch] = process.argv.slice(2);
    if (command === 'verify-group' && directory) {
      await verifyFeed(path.join(directory, `appcast-${arch}.xml`), { version, arch });
      return;
    }
    if (command !== 'verify-collected' || !directory) fail('Usage: sparkle-appcast.cjs verify-collected <artifacts> | verify-group <directory> <version> <arch>');
    for (const arch of ['arm64', 'x64']) {
      const name = fs.readdirSync(directory).find(name => new RegExp(`^Gnosi-(.+)-${arch}\\.zip$`).test(name));
      if (!name) fail(`Missing ${arch} Sparkle archive.`);
      await verifyFeed(path.join(directory, `appcast-${arch}.xml`), { arch, version: name.slice(6, -arch.length - 5) });
    }
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
