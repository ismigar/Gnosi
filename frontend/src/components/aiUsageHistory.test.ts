import { describe, expect, it } from 'vitest';

import type { AiUsageHistory } from '../shared/api/ai';
import {
    buildModelProfileMap,
    formatUsageCost,
    formatUsageTokens,
    processAiUsageHistory,
} from './aiUsageHistory';


const HISTORY: AiUsageHistory = {
    currency: {
        code: 'EUR',
        fetched_at: '2026-08-29T00:00:00Z',
        source: 'test',
        symbol: '€',
        usd_rate: 0.9,
    },
    periods: {
        '2026-06': {
            models: [{
                cost_ccy: 0.45,
                cost_usd: 0.5,
                in: 200,
                model_id: 'claude-sonnet',
                out: 100,
                provider: 'anthropic',
            }],
            period: '2026-06',
            total_ccy: 0.45,
            total_usd: 0.5,
        },
        '2026-07': {
            models: [{
                cost_ccy: 0.45,
                cost_usd: 0.5,
                in: 100,
                model_id: 'gpt-5',
                out: 50,
                provider: 'openai',
            }],
            period: '2026-07',
            total_ccy: 0.45,
            total_usd: 0.5,
        },
        '2026-08': {
            models: [
                {
                    cost_ccy: 1.8,
                    cost_usd: 2,
                    in: 1000,
                    model_id: 'gpt-5',
                    out: 200,
                    provider: 'openai',
                },
                {
                    cost_ccy: 0.9,
                    cost_usd: 1,
                    in: 500,
                    model_id: 'claude-sonnet',
                    out: 300,
                    provider: 'anthropic',
                },
            ],
            period: '2026-08',
            total_ccy: 2.7,
            total_usd: 3,
        },
    },
};


const MODEL_PROFILES = buildModelProfileMap([
    {
        model_id: 'gpt-5',
        name: 'GPT 5',
        profile: 'worker',
        provider: 'openai',
    },
    {
        model_id: 'claude-sonnet',
        name: 'Claude Sonnet',
        profile: 'expert',
        provider: 'anthropic',
    },
]);


const processHistory = (
    groupBy: 'model' | 'profile' | 'provider',
    timeframe: 'all' | 'month' | 'quarter' | 'semester' | 'year',
) => processAiUsageHistory({
    groupBy,
    history: HISTORY,
    modelProfiles: MODEL_PROFILES,
    now: new Date(2026, 7, 29),
    profileLabel: (profile) => `Profile ${profile}`,
    providerLabel: 'Provider',
    timeframe,
});


describe('AI usage history processing', () => {
    it('filters the current month and preserves model metadata', () => {
        const result = processHistory('model', 'month');

        expect(result.totalTokensIn).toBe(1500);
        expect(result.totalTokensOut).toBe(500);
        expect(result.totalCostCcy).toBeCloseTo(2.7);
        expect(result.items).toHaveLength(2);
        expect(result.items[0]).toMatchObject({
            badge: 'worker',
            costCcy: 1.8,
            icon: 'model',
            key: 'gpt-5',
            label: 'GPT 5',
        });
        expect(result.items[0]?.percent).toBeCloseTo(200 / 3);
    });

    it('aggregates the latest quarter by profile', () => {
        const result = processHistory('profile', 'quarter');

        expect(result.totalCostCcy).toBeCloseTo(3.6);
        expect(result.items).toHaveLength(2);
        expect(result.items[0]).toMatchObject({
            badge: 'worker',
            costUsd: 2.5,
            icon: 'profile',
            label: 'Profile worker',
        });
        expect(result.items[1]).toMatchObject({
            badge: 'expert',
            costUsd: 1.5,
            label: 'Profile expert',
        });
    });

    it('uses typed provider groups and compact display formatting', () => {
        const result = processHistory('provider', 'all');

        expect(result.items.map((item) => item.key)).toEqual([
            'openai',
            'anthropic',
        ]);
        expect(result.items[0]).toMatchObject({
            badge: null,
            icon: 'provider',
            label: 'OPENAI',
            subLabel: 'Provider',
        });
        expect(formatUsageTokens(1_250_000)).toBe('1.25M');
        expect(formatUsageTokens(1500)).toBe('1.5k');
        expect(formatUsageTokens(0)).toBe('0');
        expect(formatUsageCost(1.5, '$')).toMatch(/^\$1[,.]50$/);
        expect(formatUsageCost(1.5, '€')).toMatch(/^1[,.]50 €$/);
    });
});
