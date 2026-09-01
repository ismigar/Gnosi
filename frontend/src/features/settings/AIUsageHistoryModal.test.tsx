import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiUsageHistory } from '../../shared/api/ai';
import { AIUsageHistoryModal } from './AIUsageHistoryModal';


const mocks = vi.hoisted(() => ({
    fetchUsageHistory: vi.fn(),
    logError: vi.fn(),
    useModalKeyboard: vi.fn(),
}));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback ?? key,
    }),
}));
vi.mock('../../shared/hooks/useModalKeyboard', () => ({
    useModalKeyboard: mocks.useModalKeyboard,
}));
vi.mock('../../shared/notifications/notifyError', () => ({ logError: mocks.logError }));
vi.mock('../../shared/api/ai', () => ({
    fetchAiUsageHistory: mocks.fetchUsageHistory,
}));


const HISTORY: AiUsageHistory = {
    currency: {
        code: 'EUR',
        fetched_at: '2026-08-29T00:00:00Z',
        source: 'test',
        symbol: '€',
        usd_rate: 1,
    },
    periods: {
        '2026-08': {
            models: [{
                cost_ccy: 2,
                cost_usd: 2,
                in: 1000,
                model_id: 'gpt-5',
                out: 250,
                provider: 'openai',
            }],
            period: '2026-08',
            total_ccy: 2,
            total_usd: 2,
        },
    },
};


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement;
let root: Root;


beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-29T12:00:00Z'));
    vi.resetAllMocks();
    mocks.fetchUsageHistory.mockResolvedValue(HISTORY);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});


afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    vi.useRealTimers();
});


describe('AIUsageHistoryModal', () => {
    it('does not fetch or render while closed', () => {
        act(() => {
            root.render(
                <AIUsageHistoryModal isOpen={false} onClose={vi.fn()} />,
            );
        });

        expect(container.textContent).toBe('');
        expect(mocks.fetchUsageHistory).not.toHaveBeenCalled();
    });

    it('loads the typed history and keeps the close action functional', async () => {
        const onClose = vi.fn();
        await act(async () => {
            root.render(
                <AIUsageHistoryModal
                    activeModels={[{
                        model_id: 'gpt-5',
                        name: 'GPT 5',
                        profile: 'worker',
                        provider: 'openai',
                    }]}
                    isOpen
                    onClose={onClose}
                />,
            );
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.fetchUsageHistory).toHaveBeenCalledOnce();
        expect(mocks.fetchUsageHistory.mock.calls[0]?.[0]).toBeInstanceOf(
            AbortSignal,
        );
        expect(container.textContent).toContain('GPT 5');
        expect(container.textContent).toContain('Històric de consum');

        const closeButton = container.querySelector<HTMLButtonElement>(
            'button.gnosi-close-btn',
        );
        if (!closeButton) throw new Error('Close action was not rendered');
        act(() => {
            closeButton.click();
        });
        expect(onClose).toHaveBeenCalledOnce();
    });
});
