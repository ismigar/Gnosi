import {
    useEffect,
    useRef,
    useState,
    type ImgHTMLAttributes,
    type SyntheticEvent,
} from 'react';


const DEFAULT_RETRY_DELAYS_MS = [1000, 3000, 6000, 12000, 24000, 48000, 96000] as const;


function isVaultAssetUrl(source: string): boolean {
    return source.includes('/api/vault/assets/')
        || /\/api\/v1\/vaults\/[^/]+\/knowledge\/assets\//.test(source);
}


function retrySource(source: string, attempt: number): string {
    const separator = source.includes('?') ? '&' : '?';
    return `${source}${separator}gnosi_asset_retry=${String(attempt)}`;
}


interface VaultAssetImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
    readonly retryDelaysMs?: readonly number[];
    readonly src: string;
}


export function VaultAssetImage({
    onError,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    src,
    ...imageProps
}: VaultAssetImageProps) {
    const [retryState, setRetryState] = useState({ attempt: 0, source: src });
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const attempt = retryState.source === src ? retryState.attempt : 0;
    const renderedSource = attempt > 0 ? retrySource(src, attempt) : src;

    useEffect(() => () => {
        if (timerRef.current !== null) clearTimeout(timerRef.current);
    }, [src]);

    const handleError = (event: SyntheticEvent<HTMLImageElement>): void => {
        const delay = retryDelaysMs[attempt];
        if (!isVaultAssetUrl(src) || delay === undefined) {
            onError?.(event);
            return;
        }
        if (timerRef.current !== null) return;
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            setRetryState({ attempt: attempt + 1, source: src });
        }, delay);
    };

    return <img {...imageProps} onError={handleError} src={renderedSource} />;
}
