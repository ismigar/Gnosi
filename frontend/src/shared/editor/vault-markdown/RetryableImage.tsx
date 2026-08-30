import { useCallback, useEffect, useRef, useState } from 'react';


interface RetryableImageProps {
    readonly onClick?: () => void;
    readonly src: string;
    readonly title?: string;
}


const MAX_ATTEMPTS = 40;


export function RetryableImage({ src, title, onClick }: RetryableImageProps) {
    const [attempt, setAttempt] = useState(0);
    const [hidden, setHidden] = useState(false);
    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    }, []);

    const handleError = useCallback((): void => {
        if (attempt >= MAX_ATTEMPTS) {
            setHidden(true);
            return;
        }
        const delay = Math.min(500 * (2 ** attempt), 4_000);
        if (retryTimer.current !== null) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => {
            retryTimer.current = null;
            setAttempt((current) => current + 1);
        }, delay);
    }, [attempt]);

    if (hidden) return null;
    return (
        <button className="block w-full" onClick={onClick} title={title} type="button">
            <img
                alt=""
                className="h-auto w-full rounded-md border border-[var(--border-primary)]/40 bg-[var(--bg-secondary)]"
                key={attempt}
                loading="lazy"
                onError={handleError}
                src={src}
            />
        </button>
    );
}
