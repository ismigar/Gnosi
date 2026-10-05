import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ModelTaskSampleResults } from './ModelTaskSampleResults';
import { checked, suite } from './__fixtures__/taskEvidence';
const review = vi.hoisted(() => vi.fn());
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../shared/api/ai-activity', () => ({ reviewTaskEvaluation: review }));

it('shows the deliverable and saves scoped human feedback without rerunning a model', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    review.mockResolvedValue({});
    const item = checked().cases?.[0];
    if (!item) throw new Error('Missing case');
    const element = document.createElement('div'); document.body.append(element);
    const root = createRoot(element); const complete = vi.fn();
    try {
        await act(async () => { root.render(<ModelTaskSampleResults results={[{ ...item, output: '{"summary":"A text"}',
            requires_review: true, review: 'pending', reused_from: 'original-report' }]} suite={suite} busy={false} onReviewed={complete} />); await Promise.resolve(); });
        expect(element.textContent).toContain('A text');
        expect(element.textContent).toContain('model_comparison.tests.review_pending');
        await act(async () => { element.querySelector<HTMLButtonElement>('button')?.click(); await Promise.resolve(); });
        expect(review).toHaveBeenCalledWith('original-report', { case_id: item.id, verdict: 'accepted', note: '' });
        expect(complete).toHaveBeenCalledOnce();
    } finally { await act(async () => { root.unmount(); await Promise.resolve(); }); element.remove(); }
});
