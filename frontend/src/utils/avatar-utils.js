/**
 * Utilities for fetching and managing contact avatars.
 */

/**
 * Checks if an email belongs to a Gmail/Google account.
 * @param {string} email 
 * @returns {boolean}
 */
export const isGmail = (email) => {
    if (!email) return false;
    const lowerEmail = email.toLowerCase();
    return lowerEmail.endsWith('@gmail.com') || lowerEmail.endsWith('@googlemail.com');
};

/**
 * Attempts to get a Google Profile Photo URL for a given email.
 * Note: These public URLs have limitations and might not always work 
 * without authentication, but provide a good fallback.
 * 
 * @param {string} email 
 * @returns {string} 
 */
export const getGoogleAvatarUrl = (email) => {
    if (!email) return '';
    // L'antiga URL "semipública" `profiles.google.com/s2/photos/...` és de
    // Google+, tancat el 2019: sempre torna 404. Usar-la com a `src` d'avatar
    // provocava un 404 per cada contacte de Gmail sense foto i, pitjor, filtrava
    // l'email de cada contacte a un endpoint de Google a cada càrrega de la
    // llista. No existeix cap URL PÚBLICA per a la foto de perfil de Google
    // (caldria la People API amb OAuth), així que tornem '' i els consumidors
    // cauen elegantment a les inicials.
    return '';
};

/**
 * Gets a Gravatar URL for a given email as a secondary fallback.
 * @param {string} email 
 * @returns {string}
 */
export const getGravatarUrl = (email) => {
    if (!email) return '';
    // We would need md5 to do this properly in frontend if we want to avoid extra libs
    // For now, let's keep it simple or focus on Google.
    return '';
};
