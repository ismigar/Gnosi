import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SharedTaskBankPanel } from './SharedTaskBankPanel';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it('distinguishes an empty bank and offline unavailability without blocking local tests', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    try {
        await act(async () => { root.render(<SharedTaskBankPanel bank={{ state: 'ready', source_url: 'https://example.org',
            repository_url: 'https://github.com/ismigar/ismigar.github.io', fetched_at: '', reports: [], summaries: [] }} onRefresh={vi.fn()} />); await Promise.resolve(); });
        expect(container.textContent).toContain('model_comparison.shared.empty');
        expect(container.textContent).not.toContain('model_comparison.shared.unavailable');
        await act(async () => { root.render(<SharedTaskBankPanel onRefresh={vi.fn()} />); await Promise.resolve(); });
        expect(container.textContent).toContain('model_comparison.shared.unavailable');
        expect(container.textContent).toContain('model_comparison.shared.requirements');
    } finally { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); }
});
