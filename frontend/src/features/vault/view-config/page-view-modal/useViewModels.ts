import { useEffect } from 'react';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';

export function useViewModels({
    isOpen, viewType, api, setSummaryModels,
    setSummaryModel
}: Pick<
    ModalInput & useViewStateResult,
    'isOpen'
    | 'viewType'
    | 'api'
    | 'setSummaryModels'
    | 'setSummaryModel'
>) {
    useEffect(() => {
        if (!isOpen || viewType !== 'feed') return undefined;
        let cancelled = false;
        Promise.all([
            api.fetchAiModels(),
            api.fetchVaultSummarySettings().catch((): { settings?: Record<string, unknown> } => ({})),
        ]).then(([modelsResponse, settingsResponse]) => {
            if (cancelled) return;
            const models = modelsResponse.models
                .filter(model => model.enabled !== false && model.provider && model.model_id);
            setSummaryModels(models);
            const configuredModel = settingsResponse.settings?.model;
            const fallback = (typeof configuredModel === 'string' ? configuredModel : '')
                || (models[0] ? `${models[0].provider}:${models[0].model_id}` : '');
            setSummaryModel(current => current || fallback);
        }).catch(() => {
            if (!cancelled) setSummaryModels([]);
        });
        return () => { cancelled = true; };
    }, [api, isOpen, viewType, setSummaryModel, setSummaryModels]);
    return {};
}
export type useViewModelsResult = ReturnType<typeof useViewModels>;
