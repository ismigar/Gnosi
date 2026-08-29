import { createPortal } from 'react-dom';

import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { FilesystemPickerPanel } from './filesystem-picker/FilesystemPickerPanel';
import type {
    FilesystemPickerModalProps,
    FilesystemPickerMode,
} from './filesystem-picker/filesystemPickerTypes';
import { useFilesystemPicker } from './filesystem-picker/useFilesystemPicker';

interface OpenFilesystemPickerModalProps {
    readonly initialPath: string;
    readonly initialQuery: string;
    readonly mode: FilesystemPickerMode;
    readonly onClose: FilesystemPickerModalProps['onClose'];
    readonly onSelect: FilesystemPickerModalProps['onSelect'];
    readonly onSelectMany: NonNullable<FilesystemPickerModalProps['onSelectMany']> | null;
    readonly preferNative: boolean;
}

function OpenFilesystemPickerModal({
    initialPath,
    initialQuery,
    mode,
    onClose,
    onSelect,
    onSelectMany,
    preferNative,
}: OpenFilesystemPickerModalProps) {
    const {
        controller,
        itemRefs,
        listRef,
        modalRef,
    } = useFilesystemPicker({
        initialPath,
        initialQuery,
        mode,
        onSelect,
        onSelectMany,
        preferNative,
    });

    useModalKeyboard({
        containerRef: modalRef,
        isOpen: true,
        onClose,
        trapFocus: true,
    });

    return createPortal(
        <FilesystemPickerPanel
            itemRefs={itemRefs}
            listRef={listRef}
            modalRef={modalRef}
            mode={mode}
            onClose={onClose}
            picker={controller}
        />,
        document.body,
    );
}

export function FilesystemPickerModal({
    initialPath = '',
    initialQuery = '',
    isOpen,
    mode = 'folder',
    onClose,
    onSelect,
    onSelectMany = null,
    preferNative = true,
}: FilesystemPickerModalProps) {
    if (!isOpen) return null;
    return (
        <OpenFilesystemPickerModal
            initialPath={initialPath}
            initialQuery={initialQuery}
            mode={mode}
            onClose={onClose}
            onSelect={onSelect}
            onSelectMany={onSelectMany}
            preferNative={preferNative}
        />
    );
}
