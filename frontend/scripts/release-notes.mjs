import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, '..');
const appDir = path.resolve(frontendDir, '..');
const catalogPath = path.join(frontendDir, 'src/content/releases.json');
const changelogPath = path.join(appDir, 'CHANGELOG.md');
const locales = ['ca', 'en', 'es', 'fr'];
const sectionNames = ['highlights', 'improvements', 'fixes'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getTranslation(catalog, key) {
  return key.split('.').reduce((value, segment) => value?.[segment], catalog);
}

function comparableVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) throw new Error(`Invalid semantic version: ${version}`);
  const prerelease = match[4] ? match[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)) : [];
  return [...match.slice(1, 4).map(Number), prerelease];
}

function compareVersions(left, right) {
  const a = comparableVersion(left);
  const b = comparableVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  if (a[3].length === 0 || b[3].length === 0) return b[3].length - a[3].length;
  const length = Math.max(a[3].length, b[3].length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a[3][index];
    const rightPart = b[3][index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === 'number' && typeof rightPart !== 'number') return -1;
    if (typeof leftPart !== 'number' && typeof rightPart === 'number') return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function validate(releases, translations) {
  const versions = new Set();
  releases.forEach((release, index) => {
    comparableVersion(release.version);
    if (versions.has(release.version)) throw new Error(`Duplicate release version: ${release.version}`);
    versions.add(release.version);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(release.date)) throw new Error(`Invalid release date: ${release.date}`);
    if (!['prerelease', 'stable'].includes(release.channel)) throw new Error(`Invalid release channel: ${release.channel}`);
    if (index > 0 && compareVersions(releases[index - 1].version, release.version) <= 0) {
      throw new Error('Release entries must be ordered newest first.');
    }
    for (const section of sectionNames) {
      const keys = release.sections?.[section];
      if (!Array.isArray(keys)) throw new Error(`Missing ${section} section for ${release.version}`);
      for (const key of keys) {
        for (const locale of locales) {
          if (typeof getTranslation(translations[locale], key) !== 'string') {
            throw new Error(`Missing ${locale} translation for ${key}`);
          }
        }
      }
    }
  });

  const frontendVersion = readJson(path.join(frontendDir, 'package.json')).version;
  if (!versions.has(frontendVersion)) {
    throw new Error(`Frontend version ${frontendVersion} has no release-note entry.`);
  }
}

function renderEntry(release, translation) {
  const lines = [`## Gnosi ${release.version}`, '', `_${release.date} · ${getTranslation(translation, `release_notes.channel_${release.channel}`)}_`, ''];
  for (const section of sectionNames) {
    const keys = release.sections[section];
    if (keys.length === 0) continue;
    lines.push(`### ${getTranslation(translation, `release_notes.section_${section}`)}`, '');
    keys.forEach((key) => lines.push(`- ${getTranslation(translation, key)}`));
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function renderChangelog(releases, translation) {
  return ['# Gnosi changelog', '', ...releases.flatMap((release) => [renderEntry(release, translation), ''])].join('\n').trimEnd() + '\n';
}

function renderPublicRelease(release, translation) {
  return [
    renderEntry(release, translation),
    '',
    '### Downloads',
    '',
    '- **macOS (Apple Silicon / M1+)** → `*-arm64.dmg`',
    '- **macOS (Intel)** → `*-x64.dmg`',
    '- **Windows** → `*-Setup.exe`',
    '- **Linux** → `*-x86_64.AppImage` or `*-amd64.deb`',
    '',
    '> The binaries are unsigned. On macOS: right-click the app → **Open**. On Windows: **More info → Run anyway**.',
    '',
  ].join('\n');
}

const releases = readJson(catalogPath);
const translations = Object.fromEntries(locales.map((locale) => [
  locale,
  readJson(path.join(frontendDir, `src/locales/${locale}/translation.json`)),
]));
validate(releases, translations);

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const versionIndex = args.indexOf('--version');

if (args.includes('--check')) {
  const expected = renderChangelog(releases, translations.en);
  const actual = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
  if (actual !== expected) throw new Error('CHANGELOG.md is not synchronized with the release catalog.');
  console.log(`Release-note validation passed for ${releases.length} release(s) and ${locales.length} locale(s).`);
} else if (args.includes('--write-changelog')) {
  fs.writeFileSync(changelogPath, renderChangelog(releases, translations.en));
  console.log(`Updated ${changelogPath}`);
} else if (versionIndex !== -1 && outputIndex !== -1) {
  const version = args[versionIndex + 1].replace(/^v/, '');
  const release = releases.find((entry) => entry.version === version);
  if (!release) throw new Error(`No release notes found for ${version}.`);
  const outputPath = path.resolve(args[outputIndex + 1]);
  fs.writeFileSync(outputPath, renderPublicRelease(release, translations.en));
  console.log(`Rendered release notes for ${version} to ${outputPath}`);
} else {
  throw new Error('Use --check, --write-changelog, or --version <version> --output <path>.');
}
