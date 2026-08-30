const CALLOUT_TYPES = new Set(['info', 'warning', 'error', 'success']);

export function normalizeCalloutType(value: unknown): string {
    const normalized = legacyProtocolString(value).trim().toLowerCase();
    return CALLOUT_TYPES.has(normalized) ? normalized : 'info';
}

function legacyProtocolString(value: unknown): string {
    if (!value) return '';
    const rendered: unknown = Reflect.apply(String, undefined, [value]);
    return typeof rendered === 'string' ? rendered : '';
}

// Sentinel for file:// links inside the editor. It must not contain "__":
// markdown-it interprets that sequence as emphasis inside link destinations.
export const FILE_PROTOCOL_SENTINEL = 'https://gnosi-file-protocol.local';
export const LEGACY_FILE_PROTOCOL_SENTINEL = 'https://__gnosi_file_protocol__';
export const CORRUPTED_FILE_PROTOCOL_SENTINEL = 'https://**gnosi_file_protocol**';

export function sentinelToFileUrl(href: string): string;
export function sentinelToFileUrl<Value>(href: Value): Value | string;
export function sentinelToFileUrl<Value>(href: Value): Value | string {
    if (typeof href !== 'string') return href;
    if (href.startsWith(FILE_PROTOCOL_SENTINEL)) {
        return `file://${href.slice(FILE_PROTOCOL_SENTINEL.length)}`;
    }
    if (href.startsWith(LEGACY_FILE_PROTOCOL_SENTINEL)) {
        return `file://${href.slice(LEGACY_FILE_PROTOCOL_SENTINEL.length)}`;
    }
    if (href.startsWith(CORRUPTED_FILE_PROTOCOL_SENTINEL)) {
        return `file://${href.slice(CORRUPTED_FILE_PROTOCOL_SENTINEL.length)}`;
    }
    return href;
}

export function fileUrlToSentinel(href: string): string;
export function fileUrlToSentinel<Value>(href: Value): Value | string;
export function fileUrlToSentinel<Value>(href: Value): Value | string {
    if (typeof href !== 'string') return href;
    if (/^file:\/\//i.test(href)) {
        return FILE_PROTOCOL_SENTINEL + href.slice(7);
    }
    return href;
}
