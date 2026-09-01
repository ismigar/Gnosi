import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { InsertContentRequest, PendingInsert } from './editor-view/types';
import type { InsertContentResult } from '../../content/InsertContentModal';

export function useInsertionRequest() {
    const [pendingInsert, setPendingInsert] = useState<PendingInsert | null>(null);
    const pendingRef = useRef(pendingInsert);
    useLayoutEffect(() => { pendingRef.current = pendingInsert; }, [pendingInsert]);
    const getPendingInsert = useCallback(() => pendingRef.current, []);
    const requestInsertContent = useCallback(({ initialFile = null, initialTab = 'vault' }: InsertContentRequest = {}) => {
        const previous = pendingRef.current;
        if (previous) {
            try { previous.reject(new Error('superseded')); } catch { /* a caller may already have disposed its promise */ }
        }
        return new Promise<InsertContentResult>((resolve, reject) => {
            setPendingInsert({ initialFile, initialTab, resolve, reject });
        });
    }, []);
    return { pendingInsert, setPendingInsert, getPendingInsert, requestInsertContent };
}
