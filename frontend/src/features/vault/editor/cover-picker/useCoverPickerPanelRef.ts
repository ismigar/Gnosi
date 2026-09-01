import { useCallback, type RefCallback, type RefObject } from 'react';

import { browserViewportSize } from '../../../../shared/platform/browser-events';
import { calculateCoverPickerPosition } from './model';


interface CoverPickerPanelRefOptions {
    readonly pickerRef: RefObject<HTMLDivElement | null>;
    readonly triggerRef: RefObject<HTMLElement | null>;
}


export function useCoverPickerPanelRef({
    pickerRef,
    triggerRef,
}: CoverPickerPanelRefOptions): RefCallback<HTMLDivElement> {
    return useCallback((element) => {
        pickerRef.current = element;
        if (!element) return;

        const rect = triggerRef.current?.getBoundingClientRect();
        const position = calculateCoverPickerPosition(
            rect,
            browserViewportSize().width,
        );
        element.style.right = `${String(position.right)}px`;
        element.style.top = `${String(position.top)}px`;
    }, [pickerRef, triggerRef]);
}
