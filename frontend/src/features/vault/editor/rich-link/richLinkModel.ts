export type RichLinkTab = 'embed' | 'local' | 'url';
export type LocalLinkMode = 'link' | 'upload';
export type EmbedKind = 'audio' | 'file' | 'image' | 'video';


export interface RichLinkEditor {
    readonly getSelectedText?: () => string;
    readonly getTextCursorPosition: () => { readonly block: unknown };
    readonly insertBlocks: (
        blocks: readonly unknown[],
        referenceBlock: unknown,
        placement: 'after',
    ) => void;
    readonly insertInlineContent: (content: unknown) => void;
}


export const RICH_LINK_TAB_ORDER: readonly RichLinkTab[] = [
    'url',
    'local',
    'embed',
];


export function toFileUrl(rawPath: unknown): string {
    const path = typeof rawPath === 'string' ? rawPath.trim() : '';
    if (!path) return '';
    if (/^file:\/\//iu.test(path)) return path;
    if (/^[a-zA-Z]:[\\/]/u.test(path)) {
        return `file:///${path.replaceAll('\\', '/')}`;
    }
    if (path.startsWith('//') || path.startsWith('\\\\')) {
        return `file:${path.replaceAll('\\', '/')}`;
    }
    if (path.startsWith('/')) return `file://${path}`;
    return path;
}


export function basenameOf(rawPath: unknown): string {
    const path = typeof rawPath === 'string' ? rawPath : '';
    const cleaned = path.replace(/[\\/]+$/u, '');
    return cleaned.split(/[\\/]/u).at(-1) ?? cleaned;
}


export function detectEmbedKind(url: unknown): EmbedKind {
    const normalized = typeof url === 'string'
        ? url.toLowerCase().split('?')[0] ?? ''
        : '';
    if (/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/u.test(normalized)) return 'image';
    if (/\.(mp4|webm|ogv|mov|m4v)$/u.test(normalized)) return 'video';
    if (/\.(mp3|wav|ogg|m4a|flac)$/u.test(normalized)) return 'audio';
    return 'file';
}


export function embedKindForFile(file: File): EmbedKind {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'file';
}
