import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { AiModelComparison, AiModelComparisonEntry } from '../../../shared/api/ai';
import ca from '../../../shared/i18n/locales/ca/translation.json';
import type { Candidate } from './taskRecommendations';
import { ModelTaskRecommendations } from './ModelTaskRecommendations';

const mocks = vi.hoisted(() => ({ reports: vi.fn(), runs: vi.fn(), invoke: vi.fn(), vault: 'vault-a' }));
vi.mock('../../../shared/api/ai-activity', () => ({ fetchRoleEvaluations: mocks.reports, fetchAgentRuns: mocks.runs, runRoleEvaluation: mocks.invoke }));
vi.mock('../../../shared/hooks/useActiveVaultId', () => ({ useActiveVaultId: () => mocks.vault }));
const i18n = createInstance();
const models = [1, 2, 3].map(value => ({ id: String(value), name: `Model ${String(value)}`, intelligence: value,
    routes: [{ provider: 'p', provider_name: 'Proveïdor P', model_id: String(value), model_name: String(value),
        context_window: 64000, input_modes: ['text'], output_modes: ['text'], tool_call: true, tags: ['json'],
        is_local: false, quality: 4, cost_in: 1, cost_out: 1,
        billing: { kind: 'metered', stale: false, source_url: 'https://example.com' } }] })) as AiModelComparisonEntry[];
const feed = { models, fetched_at: '2026-10-04', currency: { code: 'EUR', symbol: '€', usd_rate: .9, source: 'test', fetched_at: '2026-10-04' } } as AiModelComparison;
let container: HTMLDivElement;
let root: Root;
beforeAll(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await i18n.init({ lng: 'ca', resources: { ca: { translation: ca } }, interpolation: { escapeValue: false } });
});
beforeEach(() => {
    vi.clearAllMocks(); mocks.vault = 'vault-a'; mocks.reports.mockResolvedValue([]); mocks.runs.mockResolvedValue([]);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });
async function render(provider = 'all') {
    await act(async () => { root.render(<I18nextProvider i18n={i18n}><ModelTaskRecommendations models={models} feed={feed} provider={provider} profile="documentalist" revision={0} /></I18nextProvider>); await Promise.resolve(); });
}
function changeInput(text: string, value: string) {
    const label = [...container.querySelectorAll('label')].find(item => item.textContent.includes(text));
    const input = label?.querySelector('input');
    if (!input) throw new Error(`Missing ${text}`);
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
it('presents three explained choices with currency, retry allowance and pending real quality', async () => {
    await render();
    expect(container.textContent).toContain('Millor equilibri');
    expect(container.textContent).toContain('Més econòmic que compleix');
    expect(container.textContent).toContain('Màxima qualitat estimada');
    expect(container.textContent).toContain('Model 3');
    expect(container.textContent).toContain('Els tres criteris coincideixen en la mateixa oferta');
    expect(container.textContent).toContain('no tres costos acumulats');
    expect(container.textContent).toContain('0.38 €'); // Two attempts, EUR FX.
    expect(container.textContent).toContain('comprensió global, cobertura i fidelitat');
    expect(container.textContent).not.toContain('model_comparison.recommend.');
    expect(mocks.reports).toHaveBeenCalledTimes(1); expect(mocks.runs).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
});
it('updates suggestions and explains exclusions when the execution budget is too low', async () => {
    await render(); changeInput('Pressupost per execució', '.01');
    expect(container.textContent).not.toContain('Model 3');
    expect(container.textContent).toContain('superen el pressupost');
    changeInput('Pressupost per execució', '1');
    expect(container.textContent).toContain('Model 3');
});
it('rejects invalid attempts and honours a selected provider with no matching offer', async () => {
    await render(); changeInput('Intents previstos', '0');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Introdueix');
    changeInput('Intents previstos', '2'); await render('other');
    expect(container.textContent).not.toContain('Model 3');
});
it('keeps recommendations available when evidence reading fails, with an explicit notice', async () => {
    mocks.reports.mockRejectedValue(new Error('offline')); await render();
    expect(container.textContent).toContain('No s’han pogut llegir totes les evidències');
    expect(container.textContent).toContain('sense proves recents verificades');
    expect(container.textContent).toContain('Model 3'); expect(mocks.invoke).not.toHaveBeenCalled();
});
it('hides the previous vault history immediately while reading a new vault', async () => {
    mocks.runs.mockResolvedValue([{ provider: 'p', model: '3', status: 'completed', parent_run_id: '', created_at: Date.now() / 1000 - 10 }]);
    await render(); expect(container.textContent).toContain('1 acabades');
    mocks.vault = 'vault-b'; mocks.runs.mockReturnValue(new Promise(() => {}));
    await render(); expect(container.textContent).not.toContain('1 acabades');
});

it('groups an identical offer and exposes configuration and assignment only for its active route', async () => {
    const configure = vi.fn<(candidate: Candidate) => void>(); const assign = vi.fn<(candidate: Candidate) => void>();
    await act(async () => { root.render(<I18nextProvider i18n={i18n}><ModelTaskRecommendations models={models} feed={feed} provider="all" profile="documentalist" revision={0}
        registry={[{ provider: 'p', model_id: '3', enabled: true }]} onConfigure={configure} onAssign={assign} botName="Coneixement" /></I18nextProvider>);  await Promise.resolve(); });
    expect(container.querySelectorAll('.model-task-choice')).toHaveLength(1);
    const actions = container.querySelectorAll<HTMLButtonElement>('.model-task-choice__actions button');
    act(() => { actions[0]?.click(); });
    expect(configure.mock.calls[0]?.[0]?.offer.route).toMatchObject({ provider: 'p', model_id: '3' });
    act(() => { actions[1]?.click(); });
    expect(assign.mock.calls[0]?.[0]?.offer.route).toMatchObject({ provider: 'p', model_id: '3' });
    expect(mocks.invoke).not.toHaveBeenCalled();
});
