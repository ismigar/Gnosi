import {
    useEffect,
    useMemo,
    useState,
    type ChangeEvent,
    type RefObject,
} from 'react';
import { iconNames } from 'lucide-react/dynamic';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../../hooks/useTheme';
import { logError } from '../../../lib/notifyError';
import { toast } from '../../../lib/toast';
import {
    fetchCustomIcons,
    importVaultIconUrl,
    saveCustomIcons as persistCustomIcons,
    uploadVaultIcon,
} from '../../../shared/api/vault-icons';
import {
    createLucideIconOptions,
    filterLucideIcons,
    MAX_CUSTOM_ICONS,
    normalizeCustomIcons,
    selectedLucideValue,
} from './model';
import { readLocalCustomIcons, writeLocalCustomIcons } from './storage';
import type {
    IconPickerController,
    IconPickerProps,
    LucideIconOption,
} from './types';


interface UseIconPickerControllerOptions {
    readonly fileInputRef: RefObject<HTMLInputElement | null>;
    readonly isOpen: boolean;
    readonly onClose: IconPickerProps['onClose'];
    readonly onSelectIcon: IconPickerProps['onSelectIcon'];
}


export function useIconPickerController({
    fileInputRef,
    isOpen,
    onClose,
    onSelectIcon,
}: UseIconPickerControllerOptions): IconPickerController {
    const { t } = useTranslation();
    const { effectiveTheme } = useTheme();
    const [activeTab, setActiveTab] = useState<IconPickerController['activeTab']>('emoji');
    const [selectedColor, setSelectedColor] = useState('default');
    const [searchTerm, setSearchTerm] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [isImportingLink, setIsImportingLink] = useState(false);
    const [linkInput, setLinkInput] = useState('');
    const [customIcons, setCustomIcons] = useState(readLocalCustomIcons);
    const [hasLoadedRemoteIcons, setHasLoadedRemoteIcons] = useState(false);
    const availableIcons = useMemo(() => createLucideIconOptions(iconNames), []);
    const filteredIcons = useMemo(
        () => filterLucideIcons(availableIcons, searchTerm),
        [availableIcons, searchTerm],
    );

    useEffect(() => {
        if (!isOpen || hasLoadedRemoteIcons) return undefined;

        let cancelled = false;
        void fetchCustomIcons()
            .then((response) => {
                if (cancelled) return;
                const remoteIcons = normalizeCustomIcons(response.icons);
                setCustomIcons(remoteIcons);
                writeLocalCustomIcons(remoteIcons);
            })
            .catch(() => {
                // The local library remains the offline fallback.
            })
            .finally(() => {
                if (!cancelled) setHasLoadedRemoteIcons(true);
            });

        return () => {
            cancelled = true;
        };
    }, [hasLoadedRemoteIcons, isOpen]);

    const saveIcons = (icons: readonly string[]): void => {
        const normalized = normalizeCustomIcons(icons);
        setCustomIcons(normalized);
        writeLocalCustomIcons(normalized);
        void persistCustomIcons(normalized).catch(() => {
            // The local library remains available if remote persistence fails.
        });
    };

    const rememberCustomIcon = (value: string): void => {
        const normalized = value.trim();
        if (!normalized) return;
        saveIcons([
            normalized,
            ...customIcons.filter((icon) => icon !== normalized),
        ].slice(0, MAX_CUSTOM_ICONS));
    };

    const removeCustomIcon = (value: string): void => {
        saveIcons(customIcons.filter((icon) => icon !== value));
    };

    const finishSelection = (value: string): void => {
        onSelectIcon(value);
        onClose();
    };

    const selectEmoji = (emoji: string): void => {
        finishSelection(emoji);
    };

    const selectLucideIcon = (icon: LucideIconOption): void => {
        finishSelection(selectedLucideValue(icon, selectedColor));
    };

    const selectCustomIcon = (icon: string): void => {
        finishSelection(icon);
    };

    const uploadFile = async (file: File): Promise<void> => {
        setIsUploading(true);
        try {
            const response = await uploadVaultIcon(file);
            const uploadedUrl = response.url;
            if (!uploadedUrl.trim()) {
                throw new Error('Upload did not return a valid URL');
            }
            rememberCustomIcon(uploadedUrl);
            finishSelection(uploadedUrl);
            toast.success(t('icon_picker.toast.upload_success'));
        } catch (error: unknown) {
            logError('icon-picker', error);
            const message = error instanceof Error && error.name === 'TimeoutError'
                ? t('icon_picker.toast.upload_timeout', 'Timeout exceeded')
                : t('icon_picker.toast.upload_error');
            toast.error(message);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleFileUpload = (event: ChangeEvent<HTMLInputElement>): void => {
        const file = event.target.files?.item(0);
        if (file) void uploadFile(file);
    };

    const importFromUrl = (): void => {
        const url = linkInput.trim();
        if (!url) return;

        setIsImportingLink(true);
        void importVaultIconUrl(url)
            .then((response) => {
                const importedUrl = response.url;
                if (!importedUrl.trim()) {
                    throw new Error('Import did not return a valid URL');
                }
                rememberCustomIcon(importedUrl);
                finishSelection(importedUrl);
                toast.success(t('icon_picker.toast.import_success'));
            })
            .catch((error: unknown) => {
                logError('icon-picker', error);
                toast.error(t('icon_picker.toast.import_error'));
            })
            .finally(() => {
                setIsImportingLink(false);
            });
    };

    return {
        activeTab,
        customIcons,
        effectiveTheme,
        filteredIcons,
        handleFileUpload,
        importFromUrl,
        isImportingLink,
        isUploading,
        linkInput,
        removeCustomIcon,
        searchTerm,
        selectCustomIcon,
        selectEmoji,
        selectLucideIcon,
        selectedColor,
        setActiveTab,
        setLinkInput,
        setSearchTerm,
        setSelectedColor,
    };
}
