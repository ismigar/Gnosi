import { useCallback, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { decodeViews } from './decode';
import type { PageViewApi, RegistryView, ViewConfig } from './types';

export function useViewSession(api: PageViewApi, existingSectionId?: string) {
    const panelRef = useRef<HTMLDivElement>(null);
    const existingViewsRequestRef = useRef(0);
    const appliedSelectionRef = useRef('');
    const [sectionId] = useState(() => existingSectionId || uuid());
    const createdViewsRef = useRef(new Map<string, string>());
    const catalogRequests = useRef(new Map<string, Promise<RegistryView[]>>());
    const readCatalog = useCallback((tableId: string) => {
        const pending = catalogRequests.current.get(tableId);
        if (pending) return pending;
        const request = api.fetchVaultViews(tableId).then(decodeViews).finally(() => { catalogRequests.current.delete(tableId); });
        catalogRequests.current.set(tableId, request);
        return request;
    }, [api]);
    const inlineSourceRef = useRef<ViewConfig | null>(null);
    const registryViewsRef = useRef(new Map<string, ViewConfig>());
    const updatedViewsRef = useRef(new Map<string, ViewConfig>());
    return { panelRef, existingViewsRequestRef, appliedSelectionRef, sectionId, createdViewsRef, readCatalog, registryViewsRef, updatedViewsRef, inlineSourceRef };
}
export type useViewSessionResult = ReturnType<typeof useViewSession>;
