import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import ca from '../../../shared/i18n/locales/ca/translation.json';
import en from '../../../shared/i18n/locales/en/translation.json';
import es from '../../../shared/i18n/locales/es/translation.json';
import fr from '../../../shared/i18n/locales/fr/translation.json';
import { AgentEvaluationLab } from './AgentEvaluationLab';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock('../../../shared/hooks/useActiveVaultId', () => ({ useActiveVaultId: () => 'test' }));
vi.mock('../../../shared/api/ai-activity', () => ({
    fetchEvaluationAgents: async () => [],
    fetchRoleEvaluations: async () => [{
        id: 'report', kind: 'strategies', model: 'Example', version: 'v1', score: 100,
        created_at: '2026-09-26',
        cases: ['allrounder', 'director_always', 'director_routes'].map(strategy => ({
            id: 'case', strategy, passed: true, model_calls: 1, latency_ms: 10, cost_usd: null,
        })),
    }],
    runRoleEvaluation: vi.fn(),
}));

describe('evaluation lab translations', () => {
    it.each(Object.entries({ ca, en, es, fr }))('renders both trial types and unknown costs in %s without missing keys', async (language, translation) => {
        const i18n = createInstance();
        await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation } } });
        const container = document.createElement('div');
        const root = createRoot(container);
        try {
            await act(async () => { root.render(<I18nextProvider i18n={i18n}><AgentEvaluationLab /></I18nextProvider>); });
            await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click(); });
            expect(container.textContent).toContain(translation.model_comparison.profile);
            expect(container.textContent).toContain(translation.model_comparison.unknown_cost);
            expect(container.textContent).not.toMatch(/agent_team\.|model_comparison\.|common\./);
            const kind = container.querySelector<HTMLSelectElement>('select');
            await act(async () => {
                if (kind) { kind.value = 'strategies'; kind.dispatchEvent(new Event('change', { bubbles: true })); }
            });
            expect(container.textContent).toContain(translation.agent_team.lab_executor);
            expect(container.textContent).not.toMatch(/agent_team\.|model_comparison\.|common\./);
        } finally {
            await act(async () => { root.unmount(); });
        }
    });
});
