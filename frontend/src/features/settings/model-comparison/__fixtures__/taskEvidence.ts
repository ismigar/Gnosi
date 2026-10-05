import type { TaskEvaluationReport, TaskEvaluationSuite } from '../../../../shared/api/ai-activity';
export const now = Date.parse('2026-10-05T00:00:00Z');
export const suite: TaskEvaluationSuite = { kind: 'basic', version: 'bot_tasks_v1', mode: 'diagnostic_default_512', max_age_days: 30, max_output_tokens: 512,
    criteria: [{ id: 'citation', metric: 'citation_fidelity', tasks: ['book', 'retrieve'], title: '', source: '', prompt: '', requires_review: false },
        { id: 'translation', metric: 'translation_fidelity', tasks: ['translate'], title: '', source: '', prompt: '', requires_review: false }] };
export const checked = (change: Partial<TaskEvaluationReport> = {}): TaskEvaluationReport => ({
    id: 'saved', agent_id: 'other-bot', provider: 'p', model: 'near', version: suite.version, mode: suite.mode,
    created_at: '2026-10-04T12:00:00Z', tasks: ['book', 'translate'], model_calls: 2, reused_cases: 0,
    budget_usd: .05, reserved_usd: 0, status: 'completed', stop_reason: '', cost_usd: .001,
    cases: [{ id: 'citation', metric: 'citation_fidelity', tasks: ['book', 'retrieve'], passed: true, failure: '',
        checked_at: '2026-10-04T12:00:00Z', latency_ms: 100, cost_usd: .0005, cost_source: 'estimated', reused_from: '', evidence_origin: 'local', observations: 1, contributors: 1,
        output: '', task_prompt: '', requires_review: false, review: 'not_required', review_note: '', reviewed_at: '' },
    { id: 'translation', metric: 'translation_fidelity', tasks: ['translate'], passed: false, failure: 'contract_mismatch',
        checked_at: '2026-10-04T12:00:00Z', latency_ms: 150, cost_usd: .0005, cost_source: 'estimated', reused_from: '', evidence_origin: 'local', observations: 1, contributors: 1,
        output: '', task_prompt: '', requires_review: false, review: 'not_required', review_note: '', reviewed_at: '' }],
    ...change,
});
