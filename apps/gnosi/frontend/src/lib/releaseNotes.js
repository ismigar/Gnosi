import releases from '../content/releases.json';

export const RELEASE_NOTE_SECTIONS = ['highlights', 'improvements', 'fixes'];

export const RELEASES = releases;

export function findRelease(version) {
  return RELEASES.find((release) => release.version === version) || null;
}

export function releaseSeenStorageKey(version) {
  return `gnosi.release-notes.seen.${version}`;
}
