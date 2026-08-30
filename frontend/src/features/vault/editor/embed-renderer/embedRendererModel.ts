import { withActiveVault } from '../../../../shared/resources/fileResource';


export type EmbedAvailability = 'checking' | 'missing' | 'ok';
export type EmbedKind =
    | 'audio'
    | 'empty'
    | 'iframe'
    | 'image'
    | 'pdf'
    | 'video'
    | 'vimeo'
    | 'youtube';
export type EmbedPickerTab = 'local' | 'url' | 'vault';


export interface EmbedBlock {
    readonly id?: string | null;
    readonly props?: Readonly<{
        caption?: unknown;
        url?: unknown;
    }> | null;
}


export interface EmbedBlockUpdate {
    readonly props: {
        readonly caption: string;
        readonly url: string;
    };
}


export interface EmbedEditor {
    readonly updateBlock: (
        blockId: string,
        update: EmbedBlockUpdate,
    ) => unknown;
}


export interface EmbedRendererProps {
    readonly block?: EmbedBlock | null;
    readonly editor?: EmbedEditor | null;
}


type VaultUrlResolver = (url: string) => string;


function isUnknownRecord(
    value: unknown,
): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function embedText(value: unknown): string {
    if (!value) return '';
    const converted: unknown = Reflect.apply(String, undefined, [value]);
    return typeof converted === 'string' ? converted.trim() : '';
}


export function readEmbedBlockText(block: EmbedBlock | null | undefined): {
    readonly caption: string;
    readonly rawUrl: string;
} {
    return {
        caption: embedText(block?.props?.caption),
        rawUrl: embedText(block?.props?.url),
    };
}


export function normalizeEmbedUrl(
    value: unknown,
    resolveVaultUrl: VaultUrlResolver = withActiveVault,
): string {
    if (typeof value !== 'string') return '';
    const normalized = value.trim();
    if (!normalized) return '';
    if (normalized.startsWith('Assets/')) {
        return resolveVaultUrl(
            `/api/vault/assets/${normalized.substring('Assets/'.length)}`,
        );
    }
    if (normalized.startsWith('/api/vault/assets/')) {
        return resolveVaultUrl(normalized);
    }
    const absoluteAsset = normalized.match(
        /^https?:\/\/[^/]+\/api\/vault\/assets\/(.+)$/i,
    );
    const assetPath = absoluteAsset?.[1];
    return assetPath
        ? resolveVaultUrl(`/api/vault/assets/${assetPath}`)
        : normalized;
}


export function detectEmbedKind(
    url: string,
    origin: string = window.location.origin,
): EmbedKind {
    if (!url) return 'empty';
    const extensionPath = url.toLowerCase().split(/[?#]/, 1).at(0) ?? '';
    if (extensionPath.endsWith('.pdf')) return 'pdf';
    if (/\.(mp4|webm|ogv|mov|m4v)$/i.test(extensionPath)) return 'video';
    if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(extensionPath)) return 'audio';
    if (/\.(jpg|jpeg|png|gif|webp|avif|svg)$/i.test(extensionPath)) return 'image';

    try {
        const parsed = new URL(url, origin);
        const host = parsed.hostname.replace(/^www\./, '');
        if (
            host === 'youtube.com'
            || host === 'youtu.be'
            || host === 'm.youtube.com'
        ) return 'youtube';
        if (host === 'vimeo.com' || host === 'player.vimeo.com') return 'vimeo';
    } catch {
        return 'iframe';
    }
    return 'iframe';
}


export function toYouTubeEmbedUrl(
    url: string,
    origin: string = window.location.origin,
): string {
    try {
        const parsed = new URL(url, origin);
        const host = parsed.hostname.replace(/^www\./, '');
        let videoId = '';
        if (host === 'youtu.be') {
            videoId = parsed.pathname.slice(1);
        } else if (parsed.pathname === '/watch') {
            videoId = parsed.searchParams.get('v') ?? '';
        } else if (parsed.pathname.startsWith('/embed/')) {
            return url;
        } else if (parsed.pathname.startsWith('/shorts/')) {
            videoId = parsed.pathname.replace('/shorts/', '').split('/').at(0) ?? '';
        }
        return videoId
            ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`
            : url;
    } catch {
        return url;
    }
}


export function toVimeoEmbedUrl(
    url: string,
    origin: string = window.location.origin,
): string {
    try {
        const parsed = new URL(url, origin);
        if (parsed.hostname.includes('player.vimeo.com')) return url;
        const segments = parsed.pathname.split('/').filter(Boolean);
        const idIndex = segments.findIndex((segment) => /^\d+$/.test(segment));
        if (idIndex === -1) return url;
        const identifier = segments.at(idIndex);
        if (!identifier) return url;
        const hash = segments.at(idIndex + 1);
        const playerUrl = `https://player.vimeo.com/video/${encodeURIComponent(identifier)}`;
        return hash ? `${playerUrl}?h=${encodeURIComponent(hash)}` : playerUrl;
    } catch {
        return url;
    }
}


export function isLocalFileEmbedUrl(url: string): boolean {
    return /^\/api\/vault\/local-file\//.test(url);
}


export function getImageRetryDelay(attempt: number): number | null {
    return attempt < 40 ? Math.min(500 * (2 ** attempt), 4000) : null;
}


export function readInsertResultUrl(result: unknown): string | null {
    if (!isUnknownRecord(result)) return null;
    const { url } = result;
    return typeof url === 'string' && url ? url : null;
}


export function isDismissedEmbedPickerError(error: unknown): boolean {
    let message = '';
    if (error instanceof Error) {
        message = error.message;
    } else if (isUnknownRecord(error) && typeof error.message === 'string') {
        message = error.message;
    }
    return /cancelled|superseded/.test(message);
}
