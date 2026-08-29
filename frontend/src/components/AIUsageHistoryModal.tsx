import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { logError } from '../lib/notifyError';
import {
    fetchAiUsageHistory,
    type AiUsageHistory,
} from '../shared/api/ai';
import { AIUsageHistoryView } from './AIUsageHistoryView';
import {
    buildModelProfileMap,
    processAiUsageHistory,
    type ActiveUsageModel,
    type UsageGroup,
    type UsageTimeframe,
} from './aiUsageHistory';
import './AIUsageHistoryModal.css';


export interface AIUsageHistoryModalProps {
    readonly activeModels?: readonly ActiveUsageModel[];
    readonly isOpen: boolean;
    readonly onClose: () => void;
}


const EMPTY_ACTIVE_MODELS: readonly ActiveUsageModel[] = [];


const signalIsAborted = (signal: AbortSignal): boolean => signal.aborted;


export function AIUsageHistoryModal({
    activeModels = EMPTY_ACTIVE_MODELS,
    isOpen,
    onClose,
}: AIUsageHistoryModalProps) {
    const { t } = useTranslation();
    const [timeframe, setTimeframe] = useState<UsageTimeframe>('month');
    const [groupBy, setGroupBy] = useState<UsageGroup>('model');
    const [historyData, setHistoryData] = useState<AiUsageHistory | null>(null);
    const [loading, setLoading] = useState(false);
    const dialogRef = useRef<HTMLElement | null>(null);

    useModalKeyboard({
        containerRef: dialogRef,
        isOpen,
        onClose,
        trapFocus: true,
    });

    useEffect(() => {
        if (!isOpen) return undefined;
        const controller = new AbortController();
        void Promise.resolve().then(async () => {
            if (signalIsAborted(controller.signal)) return;
            setLoading(true);
            try {
                const history = await fetchAiUsageHistory(controller.signal);
                if (!signalIsAborted(controller.signal)) setHistoryData(history);
            } catch (error: unknown) {
                if (!signalIsAborted(controller.signal)) {
                    logError('ai-usage-history', error);
                    setHistoryData(null);
                }
            } finally {
                if (!signalIsAborted(controller.signal)) setLoading(false);
            }
        });
        return () => {
            controller.abort();
        };
    }, [isOpen]);

    const modelProfiles = useMemo(
        () => buildModelProfileMap(activeModels),
        [activeModels],
    );
    const processed = useMemo(() => processAiUsageHistory({
        groupBy,
        history: historyData,
        modelProfiles,
        profileLabel: (profile) => t(
            `model_comparison.profiles.${profile}`,
            profile,
        ),
        providerLabel: t('settings.ai.provider', 'Proveïdor'),
        timeframe,
    }), [groupBy, historyData, modelProfiles, t, timeframe]);

    if (!isOpen) return null;

    return (
        <AIUsageHistoryView
            dialogRef={dialogRef}
            groupBy={groupBy}
            isLoading={loading}
            onClose={onClose}
            onGroupByChange={setGroupBy}
            onTimeframeChange={setTimeframe}
            processed={processed}
            timeframe={timeframe}
        />
    );
}


export default AIUsageHistoryModal;
