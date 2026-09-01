import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toast } from '../../../../shared/notifications/toast';
import {
    fetchMediaPage,
    fetchMediaRoots,
    fetchMediaTree,
    type MediaItem,
    type MediaPageQuery,
    type MediaRoot,
    type MediaTreeNode,
} from '../../../../shared/api/media-browser';
import {
    DEFAULT_MEDIA_ROOT,
    filterMediaItems,
} from './model';
import type {
    MediaKindFilter,
    MediaPickerController,
} from './types';


export function useMediaPickerController(
    kindFilter: MediaKindFilter,
): MediaPickerController {
    const { t } = useTranslation();
    const [roots, setRoots] = useState<readonly MediaRoot[]>([]);
    const [activeRoot, setActiveRoot] = useState(DEFAULT_MEDIA_ROOT);
    const [tree, setTree] = useState<readonly MediaTreeNode[]>([]);
    const [activePath, setActivePath] = useState<string | null>(null);
    const [items, setItems] = useState<readonly MediaItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');

    useEffect(() => {
        let cancelled = false;
        void fetchMediaRoots()
            .then((response) => {
                if (cancelled) return;
                const available = response.filter((root) => root.available);
                setRoots(available);
                if (!available.some((root) => root.key === DEFAULT_MEDIA_ROOT)) {
                    const firstRoot = available[0];
                    if (firstRoot) setActiveRoot(firstRoot.key);
                }
            })
            .catch(() => {
                if (!cancelled) setRoots([]);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        void fetchMediaTree(activeRoot)
            .then((response) => {
                if (cancelled) return;
                setTree(response);
                setActivePath(null);
                setItems([]);
            })
            .catch(() => {
                if (!cancelled) setTree([]);
            });
        return () => {
            cancelled = true;
        };
    }, [activeRoot]);

    useEffect(() => {
        if (activePath === null) return undefined;
        let cancelled = false;
        const query: MediaPageQuery = {
            limit: 200,
            offset: 0,
            root: activeRoot,
            ...(activePath ? { album: activePath } : {}),
        };
        void fetchMediaPage(query)
            .then((response) => {
                if (!cancelled) setItems(response.items);
            })
            .catch(() => {
                if (cancelled) return;
                toast.error(t(
                    'media_picker.load_error',
                    'Files could not be loaded',
                ));
                setItems([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [activePath, activeRoot, t]);

    const selectPath = useCallback((path: string): void => {
        if (path === activePath) return;
        setLoading(true);
        setActivePath(path);
    }, [activePath]);

    const filteredItems = useMemo(
        () => filterMediaItems(items, search, kindFilter),
        [items, kindFilter, search],
    );

    return {
        activePath,
        activeRoot,
        filteredItems,
        loading,
        roots,
        search,
        selectPath,
        selectRoot: setActiveRoot,
        setSearch,
        tree,
    };
}
