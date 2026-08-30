import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Trash2} from 'lucide-react';
import toast from '../../lib/toast';
import {createMediaView, deleteMediaView, fetchMediaViews, updateMediaView, type MediaView} from '../../shared/api/media-browser';
import type {MediaCollection} from './useMediaCollection';
import type {MediaConfirmation} from './ConfirmDialog';

export function useMediaViews({activeRoot, activeAlbum, filters, sort, activeViewId, setActiveViewId}: MediaCollection) {
    const {t} = useTranslation();
    const [views, setViews] = useState<MediaView[]>([]);
    const [viewPromptOpen, setViewPromptOpen] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState<MediaConfirmation | null>(null);
    useEffect(() => {
        void fetchMediaViews().then(data => {setViews(Array.isArray(data) ? data : []);})
            .catch(() => { /* Existing views remain available when loading fails. */ });
    }, []);
    const handleSaveAsView = useCallback(() => {setViewPromptOpen(true);}, []);
    const submitNewView = useCallback(async (label: string) => {
        setViewPromptOpen(false);
        try {
            const data = await createMediaView({label, scope: {root: activeRoot, album: activeAlbum || ''}, filters, sort});
            setViews(previous => [...previous, data]); setActiveViewId(data.id); toast.success(t('media.view_saved'));
        } catch {toast.error(t('media.view_save_error'));}
    }, [activeRoot, activeAlbum, filters, sort, setActiveViewId, t]);
    const handleUpdateView = useCallback(async () => {
        if (!activeViewId) return;
        const current = views.find(view => view.id === activeViewId);
        try {
            const data = await updateMediaView(activeViewId, {label: current?.label || '',
                scope: {root: activeRoot, album: activeAlbum || ''}, filters, sort});
            setViews(previous => previous.map(view => view.id === activeViewId ? data : view));
            toast.success(t('media.view_updated'));
        } catch {toast.error(t('media.view_update_error'));}
    }, [activeViewId, activeRoot, activeAlbum, filters, sort, views, t]);
    const handleDeleteView = useCallback((id: string) => {
        const view = views.find(item => item.id === id);
        const remove = async () => {
            setConfirmDialog(null);
            try {
                await deleteMediaView(id);
                setViews(previous => previous.filter(item => item.id !== id));
                if (activeViewId === id) setActiveViewId(null);
            } catch {toast.error(t('media.view_delete_error'));}
        };
        setConfirmDialog({title: t('media.delete_view_title'),
            message: view ? t('media.delete_view_msg', {label: view.label}) : t('media.delete_view_msg_generic'),
            confirmLabel: t('media.confirm_delete'), danger: true, Icon: Trash2,
            onConfirm: () => {void remove();}});
    }, [activeViewId, views, setActiveViewId, t]);
    return {views, viewPromptOpen, setViewPromptOpen, handleSaveAsView, submitNewView,
        handleUpdateView, confirmDialog, setConfirmDialog, handleDeleteView};
}
