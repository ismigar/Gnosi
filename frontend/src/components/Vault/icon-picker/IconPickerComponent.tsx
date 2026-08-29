import { useRef } from 'react';
import { createPortal } from 'react-dom';

import { useModalKeyboard } from '../../../hooks/useModalKeyboard';
import { browserDocumentBody } from '../../../shared/platform/browser-events';
import { IconPickerPanel } from './IconPickerPanel';
import type { IconPickerProps } from './types';
import { useIconPickerController } from './useIconPickerController';
import { useOutsideClose } from './useOutsideClose';
import { usePickerPanelRef } from './usePickerPanelRef';


export function IconPickerComponent({
    anchorRect = null,
    currentIcon,
    isOpen,
    onClose,
    onSelectIcon,
    triggerRef = null,
}: IconPickerProps) {
    const pickerRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const controller = useIconPickerController({
        fileInputRef,
        isOpen,
        onClose,
        onSelectIcon,
    });
    const panelRef = usePickerPanelRef({
        anchorRect,
        pickerRef,
        triggerRef,
    });

    useOutsideClose({ isOpen, onClose, pickerRef, triggerRef });
    useModalKeyboard({ isOpen, onClose });

    if (!isOpen) return null;

    return createPortal(
        <IconPickerPanel
            controller={controller}
            currentIcon={currentIcon}
            fileInputRef={fileInputRef}
            panelRef={panelRef}
        />,
        browserDocumentBody(),
    );
}
