import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../tests/mount-react';
import { PromptModal } from './PromptModal';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }) }));
afterEach(() => { vi.useRealTimers(); });

describe('prompt opening', () => {
    it('retains typing that arrives immediately after opening', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const submit = vi.fn();
        mountTestComponent(<PromptModal isOpen title="Name" label="Draft" confirmText="Save" onClose={vi.fn()} onSubmit={submit} />);
        const input = document.querySelector<HTMLInputElement>('input');
        if (!input) throw new Error('Missing input');
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Typed immediately');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => { await vi.runOnlyPendingTimersAsync(); });
        expect(input.value).toBe('Typed immediately');
        const save = [...document.querySelectorAll('button')].find(button => button.textContent === 'Save');
        if (!save) throw new Error('Missing save');
        await act(async () => { save.click(); await Promise.resolve(); });
        expect(submit).toHaveBeenCalledWith('Typed immediately');
    });
});
