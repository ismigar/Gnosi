import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Debounce edits, serialize writes and flush the latest valid draft on close. */
export function useDraftAutosave<T>(value: T, valid: boolean, save: (value: T) => Promise<unknown>, saveInitial = false) {
    const key = JSON.stringify(value);
    const persisted = useRef(saveInitial ? null : key);
    const [savedKey, setSavedKey] = useState<string | null>(saveInitial ? null : key);
    const latest = useRef({ value, valid, key });
    const writer = useRef(save);
    const mounted = useRef(true);
    const running = useRef<Promise<boolean> | null>(null);
    const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    useLayoutEffect(() => { latest.current = { value, valid, key }; writer.current = save; }, [value, valid, key, save]);
    const flush = useCallback(async (): Promise<boolean> => {
        if (running.current) return running.current;
        const task = async () => {
            for (;;) {
                const snapshot = latest.current;
                if (snapshot.key === persisted.current) return true;
                if (!snapshot.valid) return false;
                if (mounted.current) setStatus('saving');
                try {
                    await writer.current(snapshot.value);
                    persisted.current = snapshot.key;
                    if (mounted.current) { setSavedKey(snapshot.key); setStatus('saved'); }
                } catch {
                    if (mounted.current) setStatus('error');
                    return false;
                }
            }
        };
        running.current = task().finally(() => { running.current = null; });
        return running.current;
    }, []);
    useEffect(() => {
        if (!valid || key === persisted.current) return;
        const timer = window.setTimeout(() => { void flush(); }, 600);
        return () => { window.clearTimeout(timer); };
    }, [key, valid, flush]);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            // StrictMode remounts synchronously; a real close flushes pending edits.
            queueMicrotask(() => { if (!mounted.current) void flush(); });
        };
    }, [flush]);
    const dirty = key !== savedKey;
    return { flush, status: dirty && (status === 'idle' || status === 'saved') ? 'pending' as const : status, dirty };
}
