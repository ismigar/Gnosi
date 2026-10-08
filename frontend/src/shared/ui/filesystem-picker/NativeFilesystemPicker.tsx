import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { notifyError } from '../../notifications/notifyError';
import { readFilesystemPickerLastPath, saveFilesystemPickerLastPath } from './filesystem-picker/filesystemPickerModel';
import type { FilesystemPickerModalProps } from './filesystem-picker/filesystemPickerTypes';

type NativePicker = NonNullable<Window['electronAPI']>['pickFilesystem'];
export function NativeFilesystemPicker({ picker, mode = 'folder', initialPath = '', onSelect, onSelectMany, onClose }: FilesystemPickerModalProps & { picker: NonNullable<NativePicker> }) {
    const { t } = useTranslation();
    const pending = useRef<ReturnType<NonNullable<NativePicker>> | null>(null);
    useEffect(() => {
        let active = true;
        pending.current ??= picker({
            mode, multiple: mode !== 'folder' && Boolean(onSelectMany),
            title: t(`fs_picker.${mode === 'any' ? 'title_any' : mode === 'file' ? 'title_file' : 'title_folder'}`),
            initialPath: initialPath || readFilesystemPickerLastPath(),
            fileLabel: t('fs_picker.title_file'), folderLabel: t('fs_picker.title_folder'), cancelLabel: t('common.cancel'),
        });
        void pending.current.then(result => {
            if (!active) return;
            const first = result.entries[0];
            if (!result.canceled && first) {
                const path = first.path.replace(/\\/gu, '/');
                saveFilesystemPickerLastPath(first.isDir ? path : path.slice(0, path.lastIndexOf('/')));
                if (onSelectMany && result.entries.length > 1) onSelectMany([...result.entries]);
                else onSelect(first.path, { isDir: first.isDir });
            }
            onClose();
        }).catch((error: unknown) => {
            if (!active) return;
            notifyError('native-filesystem-picker', error, t('fs_picker.native_error'));
            onClose();
        });
        return () => { active = false; };
    }, [picker, mode, initialPath, onSelect, onSelectMany, onClose, t]);
    return null;
}
