import { useEffect, type RefObject } from 'react';

import {
    eventTargetIsWithin,
    subscribeDocumentEvent,
} from '../../../../shared/platform/browser-events';


interface OutsideCloseOptions {
    readonly isOpen: boolean;
    readonly onClose: () => unknown;
    readonly pickerRef: RefObject<HTMLElement | null>;
    readonly triggerRef: RefObject<HTMLElement | null>;
}


export function useOutsideClose({
    isOpen,
    onClose,
    pickerRef,
    triggerRef,
}: OutsideCloseOptions): void {
    useEffect(() => {
        if (!isOpen) return undefined;

        return subscribeDocumentEvent('mousedown', (event) => {
            const picker = pickerRef.current;
            const trigger = triggerRef.current;
            const clickedPicker = picker
                ? eventTargetIsWithin(picker, event.target)
                : false;
            const clickedTrigger = trigger
                ? eventTargetIsWithin(trigger, event.target)
                : false;
            if (!clickedPicker && !clickedTrigger) onClose();
        });
    }, [isOpen, onClose, pickerRef, triggerRef]);
}
