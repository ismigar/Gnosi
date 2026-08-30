import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { boundedJob, boundedTransparencyMetadata } from '../agentChatTransparency';
import { boundedTurnMetrics } from '../agentChatTiming';
import { MessageDetails } from './MessageDetails';
import type { MessageDetailsData, MessageJobAction } from './messageDetailsModel';

const locale = createInstance();
let container: HTMLDivElement;
let root: Root;
const onJobAction = vi.fn<(action?: MessageJobAction) => void>();
const onFocusComposer = vi.fn<(value: string) => void>();
beforeAll(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await locale.init({ lng: 'en', fallbackLng: 'en', resources: {}, interpolation: { escapeValue: false } });
});
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); });

async function render(msg: MessageDetailsData): Promise<void> {
  await act(async () => {
    root.render(<I18nextProvider i18n={locale}><MessageDetails msg={msg} onJobAction={onJobAction} onFocusComposer={onFocusComposer} /></I18nextProvider>);
    await Promise.resolve();
  });
}
async function click(label: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => { button.click(); await Promise.resolve(); });
}
function buttons(): string[] { return [...container.querySelectorAll('button')].map((button) => button.textContent); }

describe('typed response details', () => {
  it('keeps user alignment, model strategy, timing defaults and cost precision', async () => {
    await render({ role: 'user', llm: { model: 'fixture-model', strategy: { mode: 'balanced' } }, timings: boundedTurnMetrics({ total_ms: 1234, input_tokens: 3, output_tokens: 4, model_calls: 1, tool_calls: 2, estimated_cost_usd: 0.0000124 }), confirmation: {}, attachments: [{ name: 'fixture.txt' }] });
    expect(container.firstElementChild?.getAttribute('style')).toContain('align-self: flex-end');
    for (const text of ['Model: fixture-model', 'Strategy: balanced', 'Server total: 1234 ms', 'Setup: 0 ms', '3 input tokens · 4 output tokens · 1 model calls · 2 tool calls', '$0.000012', 'governed action confirmation', '1 attachment(s)']) {
      expect(container.textContent).toContain(text);
    }
    expect(buttons()).toEqual([]);
  });
  it('preserves explanation budget precedence and the plan-only fallback', async () => {
    const plan = { budgets: { max_model_calls: 2, max_tool_calls: 3, timeout_seconds: 30 } };
    await render(boundedTransparencyMetadata({ plan, explanation: { mode: 'read', route: 'local', execution: 'single' } }));
    expect(container.textContent).toContain('Budgets: 2 model calls · 3 tool calls · 30 s');
    await render(boundedTransparencyMetadata({ plan, explanation: { budgets: { max_model_calls: 4, max_tool_calls: 5, timeout_seconds: 60 } } }));
    expect(container.textContent).toContain('Budgets: 4 model calls · 5 tool calls · 60 s');
    expect(container.textContent).not.toContain('Budgets: 2');
    await render(boundedTransparencyMetadata({ plan }));
    expect(container.textContent).toContain('Budgets: 2 model calls · 3 tool calls · 30 s');
    expect(container.textContent).not.toContain('How this response was produced');
  });
  it('shows interpretation, capabilities, deadline and checkpoint metadata in order', async () => {
    await render(boundedTransparencyMetadata({ plan: {
      interpretation: { operation: 'read', confidence: 0.876, concepts: ['Research', 'Notes'] },
      capability_broker: { candidate_tools: ['read', 'search'], guarded_tools: ['write'], discovery: { domains: [{ domain: 'vault', status: 'ready' }] } },
      deadline: { soft_seconds: 20, hard_seconds: 30 }, memory: { checkpointed: true },
    } }));
    for (const text of ['88% confidence', 'Concepts: Research, Notes', '2 candidate tools · 1 guarded tools', 'vault: ready', 'synthesize after 20 s · hard limit 30 s', 'historical tool payloads excluded']) expect(container.textContent).toContain(text);
    expect([...container.querySelectorAll('strong')].map((item) => item.textContent)).toEqual(['Request interpretation', 'Selected capabilities']);
  });
  it('displays evidence diagnostics without disclosing conflict values', async () => {
    await render({ ...boundedTransparencyMetadata({
      privacy: { classification: 'private', private_source_count: 2, data_minimized: true, private_evidence_to_remote_model: true },
      verification: { status: 'verified', evidence_count: 3, limitations: ['partial'] },
      quality: { score: 70, status: 'review', failed_checks: ['coverage'] },
      evidence_security: { status: 'tainted', categories: [{ category: 'injection', count: 1 }] },
      conflicts: { conflicts: [{ conflict_id: 'c1', entity_id: 'note', field: 'title', source_names: ['A', 'B'], values: ['PRIVATE-UNRENDERED'] }] },
      freshness: { status: 'stale', age_seconds: 3, coverage_ratio: 0.753, direct_reads: 2, refresh_scheduled: true },
    }), errorCode: 'timeout', retryable: true });
    for (const text of ['retried safely', 'private · 2 private source(s)', 'data minimized: Yes', 'configured remote model', 'verified · 3 evidence item(s)', 'Limitations: partial', '70/100 · review', 'Needs attention: coverage', '1 suspicious pattern categories', 'note · title · A, B', '75% cached · 2 direct read(s)', 'non-blocking refresh']) expect(container.textContent).toContain(text);
    expect(container.textContent).not.toContain('PRIVATE-UNRENDERED');
  });
  it('dispatches refresh and resume once and respects exhausted retry budgets', async () => {
    const job = { job_id: 'fixture-job', status: 'failed', capabilities: { resume: true, cancel: true }, retry: { attempt: 1, max_attempts: 3, model_calls_used: 2, model_call_budget: 4 } };
    await render({ job: boundedJob(job) });
    expect(buttons()).toEqual(['Refresh', 'Resume job']);
    expect(container.textContent).toContain('Attempt 1/3 · model calls 2/4');
    await click('Refresh'); await click('Resume job');
    expect(onJobAction.mock.calls).toEqual([[], ['resume']]);
    await render({ job: boundedJob({ ...job, retry: { ...job.retry, budget_exhausted: true } }) });
    expect(buttons()).toEqual(['Refresh']);
    expect(container.textContent).toContain('retry budget exhausted');
  });
  it('offers cancellation only for active jobs and fills the composer for available results', async () => {
    const job = { job_id: 'fixture-job', status: 'running', capabilities: { cancel: true, result: true } };
    await render({ job: boundedJob(job) });
    expect(buttons()).toEqual(['Refresh', 'Cancel job']); await click('Cancel job');
    expect(onJobAction).toHaveBeenCalledExactlyOnceWith('cancel');
    await render({ job: boundedJob({ ...job, status: 'completed' }) });
    expect(buttons()).toEqual(['Refresh', 'Read result']); await click('Read result');
    expect(onFocusComposer).toHaveBeenCalledExactlyOnceWith('Show the result of fixture-job');
    await render({ job: boundedJob({ ...job, capabilities: { result: false }, result_available: true }) });
    expect(buttons()).toEqual(['Refresh']);
  });
  it('omits absent metadata and shows nonretryable recovery without job actions', async () => {
    await render({}); expect(container.textContent).toBe('');
    await render({ errorCode: 'bad_request' }); expect(container.textContent).toBe('RecoveryEdit the request and try again.');
    expect(buttons()).toEqual([]);
  });
});
