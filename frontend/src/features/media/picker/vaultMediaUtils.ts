const IMAGE_EXTENSIONS: readonly string[] = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
];
const VIDEO_EXTENSIONS: readonly string[] = [
  'mp4',
  'webm',
  'ogg',
  'mov',
  'avi',
];
const AUDIO_EXTENSIONS: readonly string[] = [
  'mp3',
  'wav',
  'ogg',
  'flac',
  'm4a',
];

type MediaType = 'image' | 'video' | 'audio';

const extOf = (value: string): string | undefined => {
  const withoutQuery = value.split('?').at(0) ?? '';
  const withoutFragment = withoutQuery.split('#').at(0) ?? '';
  return withoutFragment.split('.').pop()?.toLowerCase();
};

export function isImageUrl(value?: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    IMAGE_EXTENSIONS.includes(extOf(value) ?? '')
  );
}

export function isVideoUrl(value?: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    VIDEO_EXTENSIONS.includes(extOf(value) ?? '')
  );
}

export function isAudioUrl(value?: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    AUDIO_EXTENSIONS.includes(extOf(value) ?? '')
  );
}

export function getMediaType(value?: unknown): MediaType | null {
  if (isImageUrl(value)) return 'image';
  if (isVideoUrl(value)) return 'video';
  if (isAudioUrl(value)) return 'audio';
  return null;
}

export function getThumbnailUrl(
  filename?: string | null,
  baseUrl = '/api',
): string {
  if (!filename) return '';
  return `${baseUrl}/api/vault/files/${encodeURIComponent(filename)}`;
}
