import {useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction} from 'react';
import {updateMediaMetadata} from '../../shared/api/media-browser';
import type {MediaAsset, MediaMetadata} from './model';

export function useMediaMetadata(activeRoot: string, setMedia: Dispatch<SetStateAction<MediaAsset[]>>) {
    const [selectedPhoto, setSelectedPhoto] = useState<MediaAsset | null>(null);
    const [editingMetadata, setEditingMetadata] = useState<MediaMetadata>({tags: [], description: ''});
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const initialMetaRef = useRef<MediaMetadata & {id: string | null}>({id: null, tags: [], description: ''});
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const saveAbortRef = useRef<AbortController | null>(null);
    const previousPhotoId = useRef<string | null>(null);
    const handlePhotoClick = useCallback((item: MediaAsset) => {
        setSelectedPhoto(item); setEditingMetadata({tags: item.tags, description: item.description || ''});
    }, []);
    const flushSave = useCallback(async (photo: MediaAsset, metadata: MediaMetadata) => {
        saveAbortRef.current?.abort();
        const controller = new AbortController(); saveAbortRef.current = controller;
        setSaveStatus('saving');
        try {
            await updateMediaMetadata({root: photo.root || activeRoot, path_in_root: photo.path_in_root,
                filename: photo.filename, album: photo.album, metadata}, controller.signal);
            initialMetaRef.current = {id: photo.id, tags: [...metadata.tags], description: metadata.description};
            setSaveStatus('saved');
            setMedia(previous => previous.map(item => item.id === photo.id
                ? {...item, tags: metadata.tags, description: metadata.description} : item));
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') return;
            setSaveStatus('error');
        }
    }, [activeRoot, setMedia]);
    useEffect(() => {
        // A new object for the same asset must not reset an in-progress edit.
        const photoId = selectedPhoto?.id ?? null;
        if (previousPhotoId.current === photoId) return;
        previousPhotoId.current = photoId;
        if (selectedPhoto) {
            initialMetaRef.current = {id: selectedPhoto.id, tags: [...selectedPhoto.tags], description: selectedPhoto.description || ''};
            void Promise.resolve().then(() => {setSaveStatus('idle');});
        }
        if (saveTimerRef.current) {clearTimeout(saveTimerRef.current); saveTimerRef.current = null;}
        saveAbortRef.current?.abort(); saveAbortRef.current = null;
        if (!selectedPhoto) initialMetaRef.current = {...initialMetaRef.current, id: null};
    }, [selectedPhoto]);
    useEffect(() => {
        if (!selectedPhoto) return;
        const initial = initialMetaRef.current;
        if (initial.id !== selectedPhoto.id) return;
        const sameTags = initial.tags.length === editingMetadata.tags.length
            && initial.tags.every((tag, index) => tag === editingMetadata.tags[index]);
        if (sameTags && (initial.description || '') === (editingMetadata.description || '')) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        const metadata = {tags: [...editingMetadata.tags], description: editingMetadata.description};
        saveTimerRef.current = setTimeout(() => {void flushSave(selectedPhoto, metadata);}, 600);
        return () => {if (saveTimerRef.current) clearTimeout(saveTimerRef.current);};
    }, [editingMetadata, selectedPhoto, flushSave]);
    useEffect(() => () => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveAbortRef.current?.abort();
    }, []);
    return {selectedPhoto, setSelectedPhoto, editingMetadata, setEditingMetadata, saveStatus, handlePhotoClick};
}
