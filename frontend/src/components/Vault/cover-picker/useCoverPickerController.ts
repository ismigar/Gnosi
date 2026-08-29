import {
    useEffect,
    useState,
    type ChangeEvent,
    type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../../lib/notifyError';
import { toast } from '../../../lib/toast';
import {
    searchUnsplashCovers,
    uploadVaultCover,
} from '../../../shared/api/vault-icons';
import type {
    CoverPickerController,
    CoverPickerProps,
    CoverPickerTab,
    UnsplashCover,
} from './types';


interface UseCoverPickerControllerOptions {
    readonly fileInputRef: RefObject<HTMLInputElement | null>;
    readonly onClose: CoverPickerProps['onClose'];
    readonly onSelectCover: CoverPickerProps['onSelectCover'];
}


export function useCoverPickerController({
    fileInputRef,
    onClose,
    onSelectCover,
}: UseCoverPickerControllerOptions): CoverPickerController {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<CoverPickerTab>('gallery');
    const [linkInput, setLinkInput] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [unsplashQuery, setUnsplashQuery] = useState('');
    const [unsplashResults, setUnsplashResults] = useState<readonly UnsplashCover[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    useEffect(() => {
        if (activeTab !== 'unsplash') return undefined;

        const timeout = globalThis.setTimeout(() => {
            const query = unsplashQuery.trim();
            if (!query) {
                setUnsplashResults([]);
                return;
            }

            setIsSearching(true);
            void searchUnsplashCovers(query)
                .then((response) => {
                    setUnsplashResults(response.results);
                })
                .catch((error: unknown) => {
                    logError('cover-picker', error);
                    toast.error(t('cover_picker.toast.unsplash_error'));
                })
                .finally(() => {
                    setIsSearching(false);
                });
        }, 500);

        return () => {
            globalThis.clearTimeout(timeout);
        };
    }, [activeTab, t, unsplashQuery]);

    const finishSelection = (cover: string): void => {
        onSelectCover(cover);
        onClose();
    };

    const uploadFile = async (file: File): Promise<void> => {
        setIsUploading(true);
        try {
            const response = await uploadVaultCover(file);
            finishSelection(response.url);
            toast.success(t('cover_picker.toast.upload_success'));
        } catch (error: unknown) {
            logError('cover-picker', error);
            toast.error(t('cover_picker.toast.upload_error'));
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleFileUpload = (event: ChangeEvent<HTMLInputElement>): void => {
        const file = event.target.files?.item(0);
        if (file) void uploadFile(file);
    };

    const applyLink = (): void => {
        const cover = linkInput.trim();
        if (cover) finishSelection(cover);
    };

    return {
        activeTab,
        applyLink,
        handleFileUpload,
        isSearching,
        isUploading,
        linkInput,
        selectCover: finishSelection,
        setActiveTab,
        setLinkInput,
        setUnsplashQuery,
        unsplashQuery,
        unsplashResults,
    };
}
