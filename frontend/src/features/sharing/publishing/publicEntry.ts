/** Even malformed publication links stay outside the authenticated bootstrap. */
export function isPublicationPath(path: string): boolean {
    return path === '/p' || path.startsWith('/p/');
}

export function publicationToken(path: string): string | null {
    return /^\/p\/([A-Za-z0-9_-]{43})\/?$/u.exec(path)?.[1] ?? null;
}

export function publicationUrl(token: string): string {
    return `${window.location.origin}/p/${encodeURIComponent(token)}`;
}
