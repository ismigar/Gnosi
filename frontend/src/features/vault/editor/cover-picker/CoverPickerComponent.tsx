import { useRef } from 'react';
import { createPortal } from 'react-dom';

import { useModalKeyboard } from '../../../../shared/hooks/useModalKeyboard';
import { browserDocumentBody } from '../../../../shared/platform/browser-events';
import { CoverPickerPanel } from './CoverPickerPanel';
import type { CoverPickerProps } from './types';
import { useCoverPickerController } from './useCoverPickerController';
import { useCoverPickerPanelRef } from './useCoverPickerPanelRef';
import { useOutsideClose } from './useOutsideClose';


export function CoverPickerComponent({
    currentCover,
    isOpen,
    onClose,
    onSelectCover,
    triggerRef,
}: CoverPickerProps) {
    const pickerRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const controller = useCoverPickerController({
        fileInputRef,
        onClose,
        onSelectCover,
    });
    const panelRef = useCoverPickerPanelRef({ pickerRef, triggerRef });

    useOutsideClose({ isOpen, onClose, pickerRef, triggerRef });
    useModalKeyboard({ isOpen, onClose });

    if (!isOpen || typeof document === 'undefined') return null;

    return createPortal(
        <CoverPickerPanel
            controller={controller}
            currentCover={currentCover}
            fileInputRef={fileInputRef}
            panelRef={panelRef}
        />,
        browserDocumentBody(),
    );
}
