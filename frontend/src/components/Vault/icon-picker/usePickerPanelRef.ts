import { useCallback, type RefCallback, type RefObject } from 'react';

import { browserViewportSize } from '../../../shared/platform/browser-events';
import { calculatePickerPosition } from './model';
import type { IconPickerAnchorRect } from './types';


interface PickerPanelRefOptions {
    readonly anchorRect?: IconPickerAnchorRect | null;
    readonly pickerRef: RefObject<HTMLDivElement | null>;
    readonly triggerRef?: RefObject<HTMLElement | null> | null;
}


export function usePickerPanelRef({
    anchorRect,
    pickerRef,
    triggerRef,
}: PickerPanelRefOptions): RefCallback<HTMLDivElement> {
    return useCallback((element) => {
        pickerRef.current = element;
        if (!element) return;

        const rect = anchorRect ?? triggerRef?.current?.getBoundingClientRect();
        const position = calculatePickerPosition(rect, browserViewportSize());
        element.style.left = `${String(position.left)}px`;
        element.style.top = `${String(position.top)}px`;
    }, [anchorRect, pickerRef, triggerRef]);
}
