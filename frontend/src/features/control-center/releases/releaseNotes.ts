import releases from './releases.json';


export const RELEASE_NOTE_SECTIONS = ['highlights', 'improvements', 'fixes'] as const;


export type ReleaseNoteSection = typeof RELEASE_NOTE_SECTIONS[number];


export interface ReleaseNote {
  readonly channel: string;
  readonly date: string;
  readonly downloadUrl?: string;
  readonly sections: Readonly<Record<ReleaseNoteSection, readonly string[]>>;
  readonly version: string;
}


export const RELEASES: readonly ReleaseNote[] = releases;


export function findRelease(version: string): ReleaseNote | null {
  return RELEASES.find((release) => release.version === version) ?? null;
}


export function releaseSeenStorageKey(version: string): string {
  return `gnosi.release-notes.seen.${version}`;
}
