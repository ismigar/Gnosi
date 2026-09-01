#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Match the existing release tag grammar; Git additionally validates ref syntax.
const RELEASE_TAG = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function git(args) {
  const result = spawnSync('git', ['--no-replace-objects', '-c', 'protocol.allow=never', ...args], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error || result.signal) {
    throw new Error('Cannot run local Git identity checks. Ensure Git is available and retry.');
  }
  return result.status === 0 ? result.stdout.trim() : null;
}

function releaseManifestVersions(root) {
  const versions = new Map();
  for (const relative of ['package.json', 'frontend/package.json', 'desktop/package.json']) {
    let document;
    try {
      document = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
    } catch (error) {
      throw new Error(`Cannot read release version from ${relative}.`);
    }
    if (!document || Array.isArray(document) || typeof document.version !== 'string') {
      throw new Error(`Missing release version in ${relative}.`);
    }
    versions.set(relative, document.version);
  }
  let pyproject;
  try {
    pyproject = fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf8');
  } catch (error) {
    throw new Error('Cannot read release version from pyproject.toml.');
  }
  let inProject = false;
  const assignments = [];
  for (const line of pyproject.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (header) {
      inProject = /^(?:project|"project"|'project')$/.test(header[1].trim());
      continue;
    }
    if (!inProject) continue;
    const assignment = line.match(
      /^\s*(?:version|"version"|'version')\s*=\s*(["'])([^"'\r\n]+)\1\s*(?:#.*)?$/,
    );
    if (assignment) assignments.push(assignment[2]);
  }
  if (assignments.length !== 1) {
    throw new Error('Expected exactly one [project].version in pyproject.toml.');
  }
  versions.set('pyproject.toml', assignments[0]);
  return versions;
}

function verifyReleaseVersions(tag) {
  const expected = tag.slice(1);
  for (const [file, version] of releaseManifestVersions(process.cwd())) {
    if (version !== expected) {
      throw new Error(
        `Release tag ${tag} does not match ${file} version ${version}. Synchronize versions before tagging.`,
      );
    }
  }
}

function verifySourceIdentity() {
  const { RELEASE_EVENT, REQUESTED_TAG, REF_TAG, REF_TYPE, EXPECTED_SHA } = process.env;
  let tag;
  if (RELEASE_EVENT === 'workflow_dispatch') {
    tag = REQUESTED_TAG;
  } else if (RELEASE_EVENT === 'push') {
    if (REF_TYPE !== 'tag') throw new Error('Push must refer to a tag, not a branch.');
    tag = REF_TAG;
  } else {
    throw new Error('Unsupported release event. Use a tag push or workflow_dispatch.');
  }
  // Comparing the whole match also rejects trailing newlines accepted by JS `$`.
  if (!tag || tag.match(RELEASE_TAG)?.[0] !== tag) {
    throw new Error('Invalid release tag. Supply an existing v<major>.<minor>.<patch> release tag.');
  }
  const ref = `refs/tags/${tag}`;
  if (git(['check-ref-format', ref]) === null) {
    throw new Error('Invalid release tag. The release name must also be a valid Git tag ref.');
  }
  if (!EXPECTED_SHA || ![40, 64].includes(EXPECTED_SHA.length) || !/^[0-9a-f]+$/.test(EXPECTED_SHA)) {
    throw new Error('EXPECTED_SHA must be a full lowercase commit hash supplied by github.sha.');
  }
  if (git(['cat-file', '-t', EXPECTED_SHA]) !== 'commit') {
    throw new Error('EXPECTED_SHA does not name a commit in this checkout. Fetch the exact CI source.');
  }
  const head = git(['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}']);
  if (head !== EXPECTED_SHA) {
    throw new Error('Checked-out HEAD does not match EXPECTED_SHA. Checkout github.sha without switching to the tag.');
  }
  if (git(['show-ref', '--verify', '--hash', ref]) === null) {
    throw new Error('Release tag is missing. Fetch the existing tag refs before running preflight.');
  }
  const commit = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  if (commit === null) {
    throw new Error('Release tag does not resolve to a commit. Select a tag whose target is source code.');
  }
  if (commit !== EXPECTED_SHA) {
    throw new Error('Release tag does not match EXPECTED_SHA. Dispatch from the same commit as the existing tag.');
  }
  verifyReleaseVersions(tag);
  process.stdout.write(`Verified release source ${tag} at ${commit}.\n`);
}

try {
  verifySourceIdentity();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
