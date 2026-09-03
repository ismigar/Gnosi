#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const [, , mode, version, catalogPath, changelogPath, translationPath, releaseUrl] = process.argv;
const sectionNames = ['highlights', 'improvements', 'fixes'];

function fail(message) {
  throw new Error(message);
}

function canonicalVersion(value) {
  if (typeof value !== 'string'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)) {
    fail(`Invalid release version: ${String(value)}`);
  }
  return value;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function translationValue(catalog, key) {
  const value = key.split('.').reduce((current, segment) => current?.[segment], catalog);
  if (typeof value !== 'string') fail(`Missing English translation for ${key}`);
  return value;
}

function renderEntry(release, translation) {
  const lines = [
    `## Gnosi ${release.version}`,
    '',
    `_${release.date} · ${translationValue(translation, `release_notes.channel_${release.channel}`)}_`,
    '',
  ];
  for (const section of sectionNames) {
    const keys = release.sections?.[section];
    if (!Array.isArray(keys)) fail(`Missing ${section} section for ${release.version}`);
    if (keys.length === 0) continue;
    lines.push(`### ${translationValue(translation, `release_notes.section_${section}`)}`, '');
    for (const key of keys) lines.push(`- ${translationValue(translation, key)}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function renderChangelog(releases, translation) {
  return ['# Gnosi changelog', '', ...releases.flatMap((release) => [
    renderEntry(release, translation),
    '',
  ])].join('\n').trimEnd() + '\n';
}

function expectedReleaseUrl(releaseVersion) {
  return `https://github.com/ismigar/Gnosi/releases/tag/v${releaseVersion}`;
}

function preparePlans() {
  canonicalVersion(version);
  if (!['pending', 'check-pending', 'published'].includes(mode)) {
    fail('Usage: release-metadata.cjs <pending|check-pending|published> <version> '
      + '<catalog> <changelog> <en-translation> [published-release-url]');
  }
  const catalogSource = fs.readFileSync(catalogPath, 'utf8');
  const changelogSource = fs.readFileSync(changelogPath, 'utf8');
  const releases = JSON.parse(catalogSource);
  const translation = readJson(translationPath);
  if (!Array.isArray(releases)) fail('Release catalog must be an array');
  const matches = releases.filter((release) => release?.version === version);
  if (matches.length !== 1) fail(`Expected exactly one release entry for ${version}`);
  const release = matches[0];

  if (mode === 'published') {
    if (version.includes('-') || version.includes('+')) {
      fail('Only a final release can be promoted to stable');
    }
    const expected = expectedReleaseUrl(version);
    if (releaseUrl !== expected) {
      fail(`Published release URL must be exactly ${expected}`);
    }
    release.channel = 'stable';
    release.downloadUrl = releaseUrl;
  } else if (mode === 'pending') {
    release.channel = 'prerelease';
    delete release.downloadUrl;
  } else if (release.channel !== 'prerelease' || release.downloadUrl !== undefined) {
    fail(`${version} must remain prerelease without a download URL until publication`);
  }

  const catalogNext = mode === 'check-pending'
    ? catalogSource
    : `${JSON.stringify(releases, null, 2)}\n`;
  const changelogNext = renderChangelog(releases, translation);
  if (mode === 'check-pending' && changelogNext.replaceAll('\r\n', '\n')
    !== changelogSource.replaceAll('\r\n', '\n')) {
    fail('CHANGELOG.md is not synchronized with pending release metadata');
  }
  return [
    { file: catalogPath, source: catalogSource, next: catalogNext },
    { file: changelogPath, source: changelogSource, next: changelogNext },
  ];
}

function replaceAtomically(plans) {
  const changed = plans.filter(({ source, next }) => source !== next);
  const staged = [];
  try {
    for (const plan of changed) {
      const stat = fs.statSync(plan.file);
      const temporary = path.join(path.dirname(plan.file),
        `.${path.basename(plan.file)}.gnosi-release-${process.pid}`);
      fs.writeFileSync(temporary, plan.next, { flag: 'wx', mode: stat.mode });
      staged.push({ ...plan, temporary, mode: stat.mode });
    }
    const committed = [];
    try {
      for (const plan of staged) {
        fs.renameSync(plan.temporary, plan.file);
        committed.push(plan);
      }
    } catch (error) {
      for (const plan of committed.reverse()) {
        const restore = `${plan.temporary}.restore`;
        fs.writeFileSync(restore, plan.source, { flag: 'wx', mode: plan.mode });
        fs.renameSync(restore, plan.file);
      }
      throw error;
    }
  } finally {
    for (const plan of staged) {
      if (fs.existsSync(plan.temporary)) fs.unlinkSync(plan.temporary);
    }
  }
}

try {
  const plans = preparePlans();
  if (mode !== 'check-pending') replaceAtomically(plans);
  process.stdout.write(mode === 'published'
    ? `Promoted published release metadata for ${version}.\n`
    : `Pending release metadata is valid for ${version}.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
