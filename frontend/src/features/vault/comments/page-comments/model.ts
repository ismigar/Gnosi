export function formatCommentDate(
    iso: string | null | undefined,
    locale: string,
): string {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString(locale, {
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            month: 'short',
        });
    } catch {
        return iso;
    }
}


function recordStatus(value: unknown): number | undefined {
    if (typeof value !== 'object' || value === null || !('status' in value)) {
        return undefined;
    }
    return typeof value.status === 'number' ? value.status : undefined;
}


export function isCommentMutationForbidden(error: unknown): boolean {
    if (recordStatus(error) === 403) return true;
    if (typeof error !== 'object' || error === null || !('response' in error)) {
        return false;
    }
    return recordStatus(error.response) === 403;
}
