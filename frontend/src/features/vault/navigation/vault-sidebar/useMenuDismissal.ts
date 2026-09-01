import { useEffect, type RefObject } from 'react';
import { eventTargetIsWithin, subscribeDocumentEvent } from '../../../../shared/platform/browser-events';

/** Preserve the delayed listener attachment and cancel both timer and subscriptions. */
export function useMenuDismissal(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
    useEffect(() => {
        let unsubscribeClick = () => { };
        let unsubscribeKey = () => { };
        const timer = open ? setTimeout(() => {
            unsubscribeClick = subscribeDocumentEvent('click', event => {
                if (ref.current && !eventTargetIsWithin(ref.current, event.target)) close();
            });
            unsubscribeKey = subscribeDocumentEvent('keydown', event => { if (event.key === 'Escape') close(); });
        }, 10) : undefined;
        return () => { clearTimeout(timer); unsubscribeClick(); unsubscribeKey(); };
    }, [open, ref, close]);
}
