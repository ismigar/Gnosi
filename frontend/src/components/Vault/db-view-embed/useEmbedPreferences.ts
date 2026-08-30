import { useCallback, useEffect, useState } from 'react';
import { useMediaQuery } from '../../../shared/hooks/useMediaQuery';
import { writeClipboardText } from '../../../shared/platform/clipboard';
import { toast } from '../../../lib/toast';
import { updateVaultView } from './api';
import { legacyText } from './decode';
import { readText, writeText, readPresets, encodePresets, importPresets } from './preferences';
import type { QuickPreset } from './types';
import type { EmbedIdentity } from './identity';
import type { EmbedState } from './useEmbedState';
export function useEmbedPreferences({ pageId, viewId, t, searchTerm, activeViewId, setSearchTerm, setShowSearch, setActiveViewId }: EmbedIdentity & EmbedState) {
    const mobile = useMediaQuery('(max-width: 768px)');
    const preferenceProfile = mobile ? 'mobile' : 'desktop';
    const densityStorageKey = `gnosi.view.feedDensity.${preferenceProfile}`;
    const [feedDensity, setFeedDensity] = useState(() => {
        try {
            const profile = window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop';
            return readText(`gnosi.view.feedDensity.${profile}`) || 'comfortable';
        } catch {
            return 'comfortable';
        }
    });
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            try {
                setFeedDensity(readText(densityStorageKey) || 'comfortable');
            } catch { /* noop */ }
        });
        return () => { window.cancelAnimationFrame(frame); };
    }, [densityStorageKey]);
    const toggleFeedDensity = useCallback(() => {
        setFeedDensity((current) => {
            const next = current === 'compact' ? 'comfortable' : current === 'comfortable' ? 'adaptive' : 'compact';
            try { writeText(densityStorageKey, next); } catch { /* noop */ }
            return next;
        });
    }, [densityStorageKey]);
    const [feedGroupMode, setFeedGroupMode] = useState(() => {
        try { return readText('gnosi.view.feedGroupMode') || 'none'; } catch { return 'none'; }
    });
    const toggleFeedGroupMode = useCallback(() => {
        setFeedGroupMode((current) => {
            const next = current === 'date' ? 'none' : 'date';
            try { writeText('gnosi.view.feedGroupMode', next); } catch { /* noop */ }
            return next;
        });
    }, []);
    const presetStorageKey = `gnosi.view.quickPresets.${preferenceProfile}.${legacyText(pageId)}.${viewId}`;
    const [quickPresets, setQuickPresets] = useState<QuickPreset[]>([]);
    const [renameQuickPresetId, setRenameQuickPresetId] = useState<string | null>(null);
    const [isImportQuickPresetOpen, setIsImportQuickPresetOpen] = useState(false);
    const persistQuickPresets = useCallback((next: QuickPreset[]) => {
        try { writeText(presetStorageKey, JSON.stringify(next)); } catch { /* noop */ }
        if (viewId) {
            updateVaultView(viewId, { quickPresets: next })
                .catch(() => { /* offline/local fallback remains available */ });
        }
    }, [presetStorageKey, viewId]);
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            try {
                setQuickPresets(readPresets(presetStorageKey));
            } catch {
                setQuickPresets([]);
            }
        });
        return () => { window.cancelAnimationFrame(frame); };
    }, [presetStorageKey]);
    const saveQuickPreset = useCallback(() => {
        setQuickPresets((current) => {
            const nextNumber = current.length + 1;
            const preset = {
                id: String(Date.now()),
                label: t('views_header.quick_view_name', { count: nextNumber }),
                searchTerm,
                density: feedDensity,
                groupMode: feedGroupMode,
                activeViewId: activeViewId || undefined,
            };
            const next = [...current.slice(-4), preset];
            persistQuickPresets(next);
            return next;
        });
    }, [activeViewId, feedDensity, feedGroupMode, persistQuickPresets, searchTerm, t]);
    const applyQuickPreset = useCallback((presetId: string) => {
        const preset = quickPresets.find((candidate) => candidate.id === presetId);
        if (!preset) return;
        setSearchTerm(preset.searchTerm || '');
        setShowSearch(Boolean(preset.searchTerm));
        if (preset.density) {
            setFeedDensity(preset.density);
            try { writeText(densityStorageKey, preset.density); } catch { /* noop */ }
        }
        if (preset.groupMode) setFeedGroupMode(preset.groupMode);
        if (preset.activeViewId) setActiveViewId(preset.activeViewId);
    }, [densityStorageKey, quickPresets, setActiveViewId, setSearchTerm, setShowSearch]);
    const renameQuickPreset = useCallback((presetId: string) => {
        setRenameQuickPresetId(presetId);
    }, []);
    const submitQuickPresetRename = useCallback((label: string) => {
        if (!label.trim() || !renameQuickPresetId) return;
        setQuickPresets((presets) => {
            const next = presets.map((preset) => preset.id === renameQuickPresetId ? { ...preset, label: label.trim() } : preset);
            persistQuickPresets(next);
            return next;
        });
        setRenameQuickPresetId(null);
    }, [persistQuickPresets, renameQuickPresetId]);
    const deleteQuickPreset = useCallback((presetId: string) => {
        setQuickPresets((presets) => {
            const next = presets.filter((preset) => preset.id !== presetId);
            persistQuickPresets(next);
            return next;
        });
    }, [persistQuickPresets]);
    const exportQuickPresets = useCallback(async () => {
        try {
            await writeClipboardText(encodePresets(quickPresets, window.location.href));
            toast.success(t('views_header.quick_views_copied', 'View configuration copied'));
        } catch {
            toast.error(t('views_header.quick_views_copy_error', 'Could not copy the configuration'));
        }
    }, [quickPresets, t]);
    const importQuickPresets = useCallback((raw: string) => {
        try {
            const next = importPresets(raw);
            setQuickPresets(next);
            persistQuickPresets(next);
            setIsImportQuickPresetOpen(false);
            toast.success(t('views_header.quick_views_imported', 'View configuration imported'));
        } catch {
            toast.error(t('views_header.quick_views_import_error', 'That configuration is not valid'));
        }
    }, [persistQuickPresets, t]);
    return { feedDensity, setFeedDensity, toggleFeedDensity, feedGroupMode, setFeedGroupMode, toggleFeedGroupMode, quickPresets, setQuickPresets, renameQuickPresetId, setRenameQuickPresetId, isImportQuickPresetOpen, setIsImportQuickPresetOpen, persistQuickPresets, presetStorageKey, saveQuickPreset, applyQuickPreset, renameQuickPreset, submitQuickPresetRename, deleteQuickPreset, exportQuickPresets, importQuickPresets };
}
export type EmbedPreferences = ReturnType<typeof useEmbedPreferences>;
