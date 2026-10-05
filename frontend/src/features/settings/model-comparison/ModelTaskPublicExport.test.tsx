import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ModelTaskPublicExport } from './ModelTaskPublicExport';

const mocks = vi.hoisted(() => ({ export: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../shared/api/ai-activity', () => ({ exportPublicTaskEvaluation: mocks.export }));
it('requires inspection before download and never sends a contribution to a public server', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.export.mockResolvedValue({ schema: 1, cases: [{ output: 'Public sample' }] });
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    await act(async () => { root.render(<ModelTaskPublicExport reportIds={['local']} disabled={false} />); await Promise.resolve(); });
    try {
        expect(mocks.export).not.toHaveBeenCalled();
        expect(container.textContent).not.toContain('model_comparison.shared.download');
        await act(async () => { container.querySelector<HTMLButtonElement>('button')?.click(); await Promise.resolve(); });
        expect(mocks.export).toHaveBeenCalledExactlyOnceWith('local');
        expect(container.querySelector('pre')?.textContent).toContain('Public sample');
        expect(container.textContent).toContain('model_comparison.shared.public_warning');
        expect(container.textContent).toContain('model_comparison.shared.download');
        expect(container.querySelector('a')?.href).toBe('https://github.com/ismigar/ismigar.github.io/tree/main/data/model-evaluations');
    } finally { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); }
});
