/**
 * vaultMediaUtils.js
 * Utilitats per detectar i renderitzar fitxers multimèdia dins del Vault.
 */

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a'];

/**
 * Detecta si un valor de camp és una URL d'imatge.
 * @param {string} value
 * @returns {boolean}
 */
export function isImageUrl(value) {
    if (!value || typeof value !== 'string') return false;
    try {
        const url = new URL(value);
        const ext = url.pathname.split('.').pop()?.toLowerCase();
        return IMAGE_EXTENSIONS.includes(ext);
    } catch {
        // Potser és un path relatiu
        const ext = value.split('.').pop()?.toLowerCase();
        return IMAGE_EXTENSIONS.includes(ext);
    }
}

/**
 * Detecta si un valor de camp és una URL de vídeo.
 * @param {string} value
 * @returns {boolean}
 */
export function isVideoUrl(value) {
    if (!value || typeof value !== 'string') return false;
    const ext = value.split('.').pop()?.toLowerCase().split('?')[0];
    return VIDEO_EXTENSIONS.includes(ext);
}

/**
 * Detecta si un valor de camp és una URL d'àudio.
 * @param {string} value
 * @returns {boolean}
 */
export function isAudioUrl(value) {
    if (!value || typeof value !== 'string') return false;
    const ext = value.split('.').pop()?.toLowerCase().split('?')[0];
    return AUDIO_EXTENSIONS.includes(ext);
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
