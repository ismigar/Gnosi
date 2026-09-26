import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ModelParameterReview } from './ModelParameterReview';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ review: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../shared/api/ai-activity', () => ({ reviewModelParameters: mocks.review }));

describe('parameter source review', () => {
    it('requires evidence and reloads after official verification', async () => {
        const container = document.createElement('div');
        const root = createRoot(container);
        const updated = vi.fn();
        mocks.review.mockResolvedValue({ model_id: 'm', status: 'pending', outcome: 'loaded', source_links: ['https://huggingface.co/Qwen'] });
        await act(async () => { await Promise.resolve(); root.render(<ModelParameterReview modelId="m" modelName="Model" onUpdated={updated} />); });
        expect(mocks.review).not.toHaveBeenCalled();
        await act(async () => { await Promise.resolve(); container.querySelector('button')?.click(); });
        expect(container.querySelector('a')?.href).toBe('https://huggingface.co/Qwen');
        const save = [...container.querySelectorAll('button')].find(b => b.textContent === 'model_comparison.review_save');
        expect(save?.disabled).toBe(true);
        const select = container.querySelector('select');
        await act(async () => { await Promise.resolve(); if (select) { select.value = 'not_published'; select.dispatchEvent(new Event('change', { bubbles: true })); } });
        await act(async () => { await Promise.resolve(); container.querySelector<HTMLElement>('[role="switch"]')?.click(); });
        expect(save?.disabled).toBe(true);
        expect(mocks.review).toHaveBeenCalledTimes(1);
        mocks.review.mockResolvedValue({ model_id: 'm', status: 'known', outcome: 'verified', total: 12, source: 'https://huggingface.co/Qwen/model', source_links: [] });
        const refresh = container.querySelector<HTMLButtonElement>('[aria-label="model_comparison.review_lookup"]');
        expect(refresh).not.toBeNull();
        await act(async () => { await Promise.resolve(); refresh?.click(); });
        expect(mocks.review).toHaveBeenLastCalledWith(expect.objectContaining({ model_id: 'm', action: 'refresh' }));
        expect(updated).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('12 B');
        await act(async () => { await Promise.resolve(); root.unmount(); });
    });
});


it('prepopulates existing evidence without treating inspection as an update', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const updated = vi.fn();
    mocks.review.mockResolvedValue({model_id:'m',status:'known',outcome:'loaded',total:12,active:3,source:'https://example.test/model',source_links:[]});
    await act(async () => { await Promise.resolve(); root.render(<ModelParameterReview modelId="m" modelName="Model" onUpdated={updated} />); });
    await act(async () => { await Promise.resolve(); container.querySelector('button')?.click(); });
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="number"]')].map(input => input.value)).toEqual(['12','3']);
    expect(container.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe('https://example.test/model');
    expect(updated).not.toHaveBeenCalled();
    await act(async () => { await Promise.resolve(); root.unmount(); });
});
