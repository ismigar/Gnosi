import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TaskEvaluationRequest } from '../../../shared/api/ai-activity';
import { ModelTaskEvaluation } from './ModelTaskEvaluation';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), run: vi.fn(), complete: vi.fn(), suite: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../shared/hooks/useActiveVaultId', () => ({ useActiveVaultId: () => 'vault' }));
vi.mock('../../../shared/api/ai-activity', () => ({ previewTaskEvaluation: mocks.preview, runTaskEvaluation: mocks.run,
    fetchTaskEvaluationSuite: mocks.suite, reviewTaskEvaluation: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.preview.mockResolvedValue({ can_run: true, case_ids: ['citation'], reused_cases: [], pending_ids: ['citation'], maximum_cost_usd: .001 });
    mocks.run.mockResolvedValue({ status: 'completed', cases: [], model_calls: 1, reused_cases: 0, cost_usd: .0001, reserved_usd: 0 });
    mocks.suite.mockResolvedValue({ version: 'work_v1', criteria: [] });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); });
async function mount(active = true, model = 'candidate', configure?: () => void, disabled = false) {
    await act(async () => { root.render(<ModelTaskEvaluation agentId="knowledge" provider="p" model={model} tasks={['book']}
        currency={{ usd_rate: .9, symbol: '€' }} active={active} onConfigure={configure} disabled={disabled} onComplete={mocks.complete} />); await Promise.resolve(); });
}
async function open() {
    const details = container.querySelector('details');
    if (!details) throw new Error('Missing details');
    await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')); await Promise.resolve(); });
}
it('reads a preview only after opening and never calls the model automatically', async () => {
    await mount(); expect(mocks.preview).not.toHaveBeenCalled();
    await open(); expect(mocks.preview).toHaveBeenCalledOnce(); expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.preview.mock.calls[0]?.[0]).toMatchObject({ agent_id: 'knowledge', provider: 'p', model: 'candidate', authorize_model_calls: false, suite: 'work' });
    expect(container.querySelector<HTMLButtonElement>('button.btn-gnosi')?.disabled).toBe(true);
});
it('requires explicit authorization and passes the converted spending limit', async () => {
    await mount(); await open();
    const authorize = container.querySelector<HTMLDivElement>('[role="switch"][aria-label="model_comparison.tests.authorize"]');
    if (!authorize) throw new Error('Missing authorization');
    await act(async () => { authorize.click(); await Promise.resolve(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('button.btn-gnosi')?.click(); await Promise.resolve(); });
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(mocks.run.mock.calls[0]?.[0]).toMatchObject({ authorize_model_calls: true, retest: false });
    expect((mocks.run.mock.calls[0]?.[0] as TaskEvaluationRequest).budget_usd).toBeCloseTo(.05);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(container.textContent).toContain('model_comparison.tests.summary');
    const details = container.querySelector('details');
    if (!details) throw new Error('Missing details');
    await act(async () => { details.open = false; details.dispatchEvent(new Event('toggle')); await Promise.resolve(); });
    expect(mocks.complete).toHaveBeenCalledOnce();
});
it('does not test a disabled candidate', async () => {
    await mount(false); await open(); expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
    expect(container.textContent).toContain('model_comparison.tests.activate_first');
    expect(mocks.suite).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('model_comparison.tests.work_set');
});
it('fully reusable evidence offers no paid run button', async () => {
    mocks.preview.mockResolvedValue({ can_run: true, reused_cases: [], pending_ids: [], maximum_cost_usd: 0 });
    await mount(); await open(); expect(container.querySelector('button.btn-gnosi')).toBeNull(); expect(mocks.run).not.toHaveBeenCalled();
});

it('does not carry consent or completed results to another model', async () => {
    await mount(); await open();
    const authorize = container.querySelector<HTMLElement>('[role="switch"][aria-label="model_comparison.tests.authorize"]');
    if (!authorize) throw new Error('Missing authorization');
    await act(async () => { authorize.click(); await Promise.resolve(); });
    await mount(true, 'other'); await open();
    expect(container.querySelector<HTMLButtonElement>('button.btn-gnosi')?.disabled).toBe(true);
    expect(container.textContent).not.toContain('model_comparison.tests.summary');
    expect(mocks.run).not.toHaveBeenCalled();
});
it('ignores a response from a model that is no longer displayed', async () => {
    let resolveRun: (value: unknown) => void = () => { throw new Error('Missing pending run'); };
    mocks.run.mockImplementation(() => new Promise(resolve => { resolveRun = resolve; }));
    await mount(); await open();
    const authorize = container.querySelector<HTMLElement>('[role="switch"][aria-label="model_comparison.tests.authorize"]');
    if (!authorize) throw new Error('Missing authorization');
    await act(async () => { authorize.click(); await Promise.resolve(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('button.btn-gnosi')?.click(); await Promise.resolve(); });
    await mount(true, 'other'); await open();
    await act(async () => { resolveRun({ status: 'completed', model_calls: 1, cost_usd: .001, reserved_usd: 0 }); await Promise.resolve(); });
    expect(container.textContent).not.toContain('model_comparison.tests.summary');
    expect(mocks.complete).not.toHaveBeenCalled();
});

it('opens setup directly for an inactive offer and returns to tests without paying or inheriting consent', async () => {
    const configure = vi.fn();
    await mount(false, 'candidate', configure);
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).toContain('model_comparison.tests.configure_to_test');
    await act(async () => { container.querySelector<HTMLButtonElement>('button')?.click(); await Promise.resolve(); });
    expect(configure).toHaveBeenCalledOnce();
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
    await mount(true, 'candidate', configure);
    expect(container.querySelector('details')?.open).toBe(true);
    expect(mocks.preview).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('model_comparison.tests.run_help');
    expect(container.querySelector<HTMLButtonElement>('button.btn-gnosi')?.disabled).toBe(true);
    expect(mocks.run).not.toHaveBeenCalled();
});
it('does not open setup when configuration actions are disabled', async () => {
    const configure = vi.fn();
    await mount(false, 'candidate', configure, true);
    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
    await act(async () => { container.querySelector<HTMLButtonElement>('button')?.click(); await Promise.resolve(); });
    expect(configure).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
});
