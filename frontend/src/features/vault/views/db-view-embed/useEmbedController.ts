import { useCallback, useContext, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { VaultEditorContext } from '../../../../shared/editor/VaultEditorContext';
import { decodeContext } from './decode';
import { subscribeAppEvent } from '../../../../shared/platform/app-events';
import { subscribeWindowEvent } from '../../../../shared/platform/browser-events';
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
    const { setReloadKey } = state;
    const reload = useCallback(() => {
        setReloadKey(k => k + 1);
    }, [setReloadKey]);
    useEffect(() => {
        const stopSaved = subscribeAppEvent('gnosi:invalidatePreview', ({ pageId }) => {
            if (pageId !== identity.pageId) reload();
        });
        const stopFocus = subscribeWindowEvent('focus', reload);
        return () => { stopSaved(); stopFocus(); };
    }, [identity.pageId, reload]);
    const actions = useEmbedRecordActions({ ...inputs, ...derived, reload });
    const tabs = useEmbedTabActions({ ...inputs, ...derived });
    const model = { ...inputs, ...derived, ...actions, ...tabs, reload };
    const adapters = createBodyAdapters(model);
    const visibleTabs = state.tableViews.filter(v => v.id === identity.viewId || (!!v.id && state.pinnedViewIds.has(v.id)));
    return { ...model, ...adapters, visibleTabs };
}
export type EmbedModel = ReturnType<typeof useEmbedController>;
