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
    // A commonly used semi-public URL for Google profile photos
    return `https://profiles.google.com/s2/photos/profile/${email}?sz=128`;
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
