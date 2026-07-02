/**
 * vaultMediaUtils.js
 * Utilitats per detectar i renderitzar fitxers multimèdia dins del Vault.
 */

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a'];

// Extreu l'extensió (en minúscules) d'una URL o path, ELIMINANT primer la query
// i el fragment. Cal fer-ho ABANS de partir per `.`: si no, una imatge relativa
// amb query (`foto.jpg?v=2`) o una query amb punt (`clip.mp4?t=1.5`) deixava
// l'extensió bruta i la detecció de mèdia fallava (no es renderitzava).
const extOf = (value) =>
    String(value).split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();

/**
 * Detecta si un valor de camp és una URL d'imatge.
 * @param {string} value
 * @returns {boolean}
 */
export function isImageUrl(value) {
    if (!value || typeof value !== 'string') return false;
    return IMAGE_EXTENSIONS.includes(extOf(value));
}

/**
 * Detecta si un valor de camp és una URL de vídeo.
 * @param {string} value
 * @returns {boolean}
 */
export function isVideoUrl(value) {
    if (!value || typeof value !== 'string') return false;
    return VIDEO_EXTENSIONS.includes(extOf(value));
}

/**
 * Detecta si un valor de camp és una URL d'àudio.
 * @param {string} value
 * @returns {boolean}
 */
export function isAudioUrl(value) {
    if (!value || typeof value !== 'string') return false;
    return AUDIO_EXTENSIONS.includes(extOf(value));
}

/**
 * Retorna el tipus de mèdia d'un valor ('image', 'video', 'audio', o null).
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
 * Construeix la URL d'una miniatura per a un fitxer del Vault.
 * @param {string} filename - Nom del fitxer
 * @param {string} [baseUrl] - URL base de l'API
 * @returns {string}
 */
export function getThumbnailUrl(filename, baseUrl = '/api') {
    if (!filename) return '';
    return `${baseUrl}/api/vault/files/${encodeURIComponent(filename)}`;
}
