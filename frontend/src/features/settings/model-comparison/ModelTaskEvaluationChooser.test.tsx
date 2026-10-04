import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { AiModelComparisonEntry, AiModelRegistryEntry } from '../../../shared/api/ai';
import { ModelTaskEvaluationChooser } from './ModelTaskEvaluationChooser';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./ModelTaskEvaluation', () => ({ ModelTaskEvaluation: ({ model }: { model: string }) => <output>{model}</output> }));
it('can check an active failed or uncatalogued model before assigning it, respecting the provider scope', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const registry = [
        { provider: 'p', model_id: 'current', enabled: true }, { provider: 'p', model_id: 'failed', enabled: true },
        { provider: 'p', model_id: 'inactive', enabled: false }, { provider: 'other', model_id: 'outside', enabled: true },
    ] as AiModelRegistryEntry[];
    const models = [{ id: 'current', routes: [{ provider: 'p', model_id: 'current' }] }] as AiModelComparisonEntry[];
    await act(async () => { root.render(<ModelTaskEvaluationChooser agentId="a" currentRoute={{ provider: 'p', model: 'current' }}
        models={models} registry={registry} tasks={['book']} currency={{ usd_rate: 1, symbol: '$' }} onComplete={vi.fn()} />);
        await Promise.resolve(); });
    try {
        const select = host.querySelector('select');
        if (!select) throw new Error('Missing active candidates');
        expect([...select.options].map(option => option.textContent)).toEqual(['current · p', 'failed · p']);
        await act(async () => { select.value = select.options[1]?.value ?? ''; select.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
        expect(host.querySelector('output')?.textContent).toBe('failed');
        expect(registry[0]?.model_id).toBe('current');
    } finally { await act(async () => { root.unmount(); await Promise.resolve(); }); host.remove(); }
});
