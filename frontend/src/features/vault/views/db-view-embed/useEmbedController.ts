import { useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { VaultEditorContext } from '../../../../shared/editor/VaultEditorContext';
import { decodeContext } from './decode';
import { byTableCache } from './cache';
import { useEmbedState } from './useEmbedState';
import { useEmbedPreferences } from './useEmbedPreferences';
import { useEmbedLoad } from './useEmbedLoad';
import { useEmbedDerived } from './useEmbedDerived';
import { useEmbedRecordActions } from './useEmbedRecordActions';
import { useEmbedTabActions } from './useEmbedTabActions';
import { createBodyAdapters } from './body-adapters';
import type { DbViewEmbedProps } from './types';
export function useEmbedController({ block }: DbViewEmbedProps) {
    const { t } = useTranslation();
    const sourceContext = useContext(VaultEditorContext);
    const ctx = useMemo(() => decodeContext(sourceContext), [sourceContext]);
    const identity = { block, ctx, t, pageId: ctx.pageId, viewId: (block?.props?.view_id || '').trim(), headingProp: block?.props?.heading || '', headingLevelProp: Number(block?.props?.heading_level) || 0 };
    const state = useEmbedState(identity);
    const preferences = useEmbedPreferences({ ...identity, ...state });
    const inputs = { ...identity, ...state, ...preferences };
    useEmbedLoad(inputs);
    const derived = useEmbedDerived(inputs);
    const { view, setReloadKey } = state;
    const reload = useCallback(() => {
        const id = view?.source_table_id || view?.table_id;
        if (id) byTableCache.delete(id);
        setReloadKey(k => k + 1);
    }, [view, setReloadKey]);
    const actions = useEmbedRecordActions({ ...inputs, ...derived, reload });
    const tabs = useEmbedTabActions({ ...inputs, ...derived });
    const model = { ...inputs, ...derived, ...actions, ...tabs, reload };
    const adapters = createBodyAdapters(model);
    const visibleTabs = state.tableViews.filter(v => v.id === identity.viewId || (!!v.id && state.pinnedViewIds.has(v.id)));
    return { ...model, ...adapters, visibleTabs };
}
export type EmbedModel = ReturnType<typeof useEmbedController>;
