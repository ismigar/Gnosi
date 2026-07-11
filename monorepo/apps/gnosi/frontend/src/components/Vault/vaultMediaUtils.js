/**
 * vaultMediaUtils.js
 * Utilities for detecting and rendering media files within the Vault.
 */

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a'];

// Extracts the extension (lowercased) from a URL or path, first REMOVING the query
// and the fragment. This must be done BEFORE splitting on `.`: otherwise, a relative image
// with a query (`foto.jpg?v=2`) or a query with a dot (`clip.mp4?t=1.5`) would leave
// the extension dirty and media detection would fail (it wouldn't render).
const extOf = (value) =>
    String(value).split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();

/**
 * Detects whether a field value is an image URL.
 * @param {string} value
 * @returns {boolean}
 */
export function isImageUrl(value) {
    if (!value || typeof value !== 'string') return false;
    return IMAGE_EXTENSIONS.includes(extOf(value));
}

/**
 * Detects whether a field value is a video URL.
 * @param {string} value
 * @returns {boolean}
 */
export function isVideoUrl(value) {
    if (!value || typeof value !== 'string') return false;
    return VIDEO_EXTENSIONS.includes(extOf(value));
}

/**
 * Detects whether a field value is an audio URL.
 * @param {string} value
 * @returns {boolean}
 */
export function isAudioUrl(value) {
    if (!value || typeof value !== 'string') return false;
    return AUDIO_EXTENSIONS.includes(extOf(value));
}

/**
 * Returns the media type of a value ('image', 'video', 'audio', or null).
 * @param {string} value
 * @returns {'image'|'video'|'audio'|null}
 */
export function getMediaType(value) {
    if (isImageUrl(value)) return 'image';
    if (isVideoUrl(value)) return 'video';
    if (isAudioUrl(value)) return 'audio';
    return null;
}

/**
 * Builds the thumbnail URL for a Vault file.
 * @param {string} filename - File name
 * @param {string} [baseUrl] - API base URL
 * @returns {string}
 */
export function getThumbnailUrl(filename, baseUrl = '/api') {
    if (!filename) return '';
    return `${baseUrl}/api/vault/files/${encodeURIComponent(filename)}`;
}
