const FOLDER_KEY_MAP = {
    // Entrada
    'inbox': 'mail.inbox',
    // Enviats
    'sent': 'mail.sent',
    'sent items': 'mail.sent',
    'sent messages': 'mail.sent',
    '[gmail]/sent mail': 'mail.sent',
    'enviats': 'mail.sent',
    // Esborranys
    'drafts': 'mail.drafts',
    '[gmail]/drafts': 'mail.drafts',
    'esborranys': 'mail.drafts',
    // Paperera
    'trash': 'mail.trash',
    'deleted': 'mail.trash',
    'deleted items': 'mail.trash',
    'deleted messages': 'mail.trash',
    '[gmail]/trash': 'mail.trash',
    'paperera': 'mail.trash',
    // Brossa
    'spam': 'mail.spam',
    'junk': 'mail.spam',
    'junk email': 'mail.spam',
    '[gmail]/spam': 'mail.spam',
    'correu brossa': 'mail.spam',
    // Destacats
    'starred': 'mail.starred',
    '[gmail]/starred': 'mail.starred',
    'destacats': 'mail.starred',
    // Arxiu / Tot el correu
    'archive': 'mail.all_mail',
    'all mail': 'mail.all_mail',
    '[gmail]/all mail': 'mail.all_mail',
};

/**
 * Returns the translated name of an IMAP folder, falling back to the raw name.
 * @param {string} name  Raw IMAP folder name
 * @param {Function} t   i18next translation function
 */
export function translateFolderName(name, t) {
    if (!name) return '';
    const key = FOLDER_KEY_MAP[name.toLowerCase()];
    return key ? t(key) : name;
}
