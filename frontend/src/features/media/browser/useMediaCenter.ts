import {useEffect, useState, type ChangeEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {useMediaQuery} from '../../../shared/hooks/useMediaQuery';
import {uploadMediaFile} from '../../../shared/api/media-browser';
import {uploadVaultAsset} from '../../../shared/api/vault-specialized';
import toast from '../../../shared/notifications/toast';
import {useMediaCollection} from './useMediaCollection';
import {useMediaMetadata} from './useMediaMetadata';
import {useMediaViews} from './useMediaViews';
import {useMediaViewer} from './useMediaViewer';
import type {MediaLayout} from './model';

export function useMediaCenter() {
    const {t} = useTranslation();
    const isCompact = useMediaQuery('(max-width: 767px)');
    const [sidebarOpen, setSidebarOpen] = useState(!isCompact);
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState<MediaLayout>('grid');
    const [isUploading, setIsUploading] = useState(false);
    const collection = useMediaCollection();
    const metadata = useMediaMetadata(collection.activeRoot, collection.setMedia);
    const views = useMediaViews(collection);
    const filteredMedia = collection.media.filter(item => item.filename.toLowerCase().includes(searchTerm.toLowerCase()));
    const viewer = useMediaViewer(filteredMedia, metadata.selectedPhoto, metadata.handlePhotoClick, metadata.setSelectedPhoto);
    useEffect(() => {
        void Promise.resolve().then(() => {setSidebarOpen(!isCompact);});
    }, [isCompact]);
    const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        if (!file) return;
        try {
            setIsUploading(true); toast.loading(t('media.uploading'), {id: 'upload'});
            if (collection.activeRoot === 'images') await uploadMediaFile(file, collection.activeAlbum || 'General');
            else await uploadVaultAsset(file);
            toast.success(t('media.upload_success'), {id: 'upload'});
            void collection.fetchMedia(true);
        } catch {toast.error(t('media.upload_error'), {id: 'upload'});}
        finally {setIsUploading(false);}
    };
    return {...collection, ...metadata, ...views, ...viewer, t, isCompact, sidebarOpen, setSidebarOpen,
        searchTerm, setSearchTerm, viewMode, setViewMode, isUploading, filteredMedia, handleUpload};
}
export type MediaCenterState = ReturnType<typeof useMediaCenter>;
