import { useCallback, useRef } from 'react';
import type { ToggleDropHandler } from './editor-effects/types';

/** Event-only bridge: registering editor options never reads the current handler. */
export function useDropBridge() {
    const toggleDropHandlerRef = useRef<ToggleDropHandler | null>(null);
    const handleDrop = useCallback<ToggleDropHandler>((...args) => {
        const handler = toggleDropHandlerRef.current;
        return handler?.(...args) ?? false;
    }, []);
    return { handleDrop, toggleDropHandlerRef };
}
