/** Returns whether a resource reference contains at least one usable value. */
export function hasResourceReference(value) {
    if (Array.isArray(value)) {
        return value.some((item) => hasResourceReference(item));
    }

    if (value && typeof value === 'object') {
        return Object.values(value).some((item) => hasResourceReference(item));
    }

    return String(value ?? '').trim().length > 0;
}
