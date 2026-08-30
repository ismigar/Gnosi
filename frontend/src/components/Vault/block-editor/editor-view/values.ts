import type { EditorBlock } from '../schema';

/** Preserve the optional legacy error-message logging boundary. */
export function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message;
    return '';
}

export function createReferenceId(): string {
    const available: { randomUUID?: () => string } | undefined = typeof crypto === 'undefined' ? undefined : crypto;
    return available?.randomUUID ? available.randomUUID() : String(Math.random()).slice(2);
}

/** Optional structural readers preserve legacy runtime guards at external boundaries. */
export function firstBlockChild(block: { readonly children?: readonly EditorBlock[] } | null | undefined): EditorBlock | undefined {
    return block?.children?.[0];
}

export function pastedText(clipboard: { readonly getData?: (format: string) => string } | null | undefined): string {
    return clipboard?.getData?.('text/plain') ?? '';
}
