
// Immutable ID for properties: 'fld_' + 8 hex chars. It is persisted in the
// table schema and is preserved across field name renames.
export const generateFieldId = () => {
    const bytes = new Uint8Array(4);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return 'fld_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
};

export const generateFunctionalityId = () => generateFieldId().replace('fld_', 'fn_');
