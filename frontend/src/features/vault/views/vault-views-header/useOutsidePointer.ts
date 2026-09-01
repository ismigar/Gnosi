import { useEffect, type RefObject } from 'react';

import {
    eventTargetIsWithin,
    subscribeDocumentEvent,
} from '../../../../shared/platform/browser-events';

export function useOutsidePointer(
    enabled: boolean,
    containerRef: RefObject<Element | null>,
    onOutside: () => void,
): void {
    useEffect(() => {
        if (!enabled) return undefined;
        return subscribeDocumentEvent('mousedown', (event) => {
            const container = containerRef.current;
            if (container && !eventTargetIsWithin(container, event.target)) {
                onOutside();
            }
        });
    }, [containerRef, enabled, onOutside]);
}
