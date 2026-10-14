const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const descriptions = require('../assets/native-privacy.json');

/** Update only the declared keys, retaining existing strings and comments. */
function mergePrivacyStrings(source, values) {
  const seen = new Set();
  const tokens = /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|("(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*")\s*;/g;
  const merged = source.replace(tokens, (token, quotedKey) => {
    if (!quotedKey) return token;
    let key;
    try { key = quotedKey.startsWith('"') ? JSON.parse(quotedKey) : quotedKey; } catch { return token; }
    if (!Object.hasOwn(values, key)) return token;
    seen.add(key);
    return `${quotedKey} = ${JSON.stringify(values[key])};`;
  });
  const additions = Object.entries(values).filter(([key]) => !seen.has(key))
    .map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)};`);
  return `${merged.trimEnd()}\n${additions.length ? `${additions.join('\n')}\n` : ''}`;
}

function readStrings(file) {
  if (!fs.existsSync(file)) return '';
  const buffer = fs.readFileSync(file);
  if (buffer.subarray(0, 6).toString() === 'bplist') {
    const values = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' }));
    return Object.entries(values).map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)};`).join('\n');
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return Buffer.from(buffer.subarray(2)).swap16().toString('utf16le');
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

/** Install localized OS purpose strings before the application bundle is sealed. */
function installNativePrivacy(appPath) {
  const resources = path.join(appPath, 'Contents', 'Resources');
  for (const [language, values] of Object.entries(descriptions)) {
    const directory = path.join(resources, `${language}.lproj`);
    const destination = path.join(directory, 'InfoPlist.strings');
    const merged = mergePrivacyStrings(readStrings(destination), values);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(destination, merged, 'utf8');
  }
}

module.exports = { installNativePrivacy, mergePrivacyStrings };
