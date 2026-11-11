import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiGenerateInput } from '../../../shared/api/ai';
import AIGenerateModal from './AIGenerateModal';


const mocks = vi.hoisted(() => ({
    generateAiContent: vi.fn(),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('../../../shared/hooks/useModalKeyboard', () => ({
    useModalKeyboard: vi.fn(),
}));

vi.mock('../../../shared/api/ai', () => ({
    generateAiContent: mocks.generateAiContent,
}));

vi.mock('../../../shared/notifications/toast', () => ({
    toast: { error: vi.fn() },
}));


describe('AIGenerateModal', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        mocks.generateAiContent.mockResolvedValue({ content: 'Generated markdown' });
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        vi.useRealTimers();
        vi.clearAllMocks();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('prepares an article edit and applies only after explicit preview approval', async () => {
        const onInsert = vi.fn();
        const onClose = vi.fn();
        const anchor = {};
        act(() => { root.render(<AIGenerateModal request={{ mode: 'free', replacePage: true, context: 'Original article', anchor }} onClose={onClose} onInsert={onInsert} />); });
        expect(document.querySelector('textarea')?.value).toContain('bold');
        expect(mocks.generateAiContent).not.toHaveBeenCalled();
        await act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent === 'Generate')?.click(); await Promise.resolve(); });
        expect(onInsert).not.toHaveBeenCalled();
        const generated = mocks.generateAiContent.mock.calls[0]?.[0] as AiGenerateInput;
        expect(generated).toMatchObject({ context: 'Original article', mode: 'free' });
        expect(generated.prompt).toContain('Preserve all wording');
        await act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent.includes('Apply edit'))?.click(); await Promise.resolve(); });
        expect(onInsert).toHaveBeenCalledWith('Generated markdown', anchor);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('generates, reviews and inserts content at the original anchor', async () => {
        const onClose = vi.fn();
        const onInsert = vi.fn();
        act(() => {
            root.render(<AIGenerateModal
                onClose={onClose}
                onInsert={onInsert}
                request={{ anchor: 'block-1', context: 'Page context', mode: 'continue' }}
            />);
            vi.advanceTimersByTime(65);
        });

        const generate = Array.from(document.body.querySelectorAll('button'))
            .find((button) => button.textContent.includes('Generate'));
        if (!generate) throw new Error('Generate action was not rendered');
        await act(async () => {
            generate.click();
            await Promise.resolve();
        });

        expect(document.body.textContent).toContain('Generated markdown');
        const insert = Array.from(document.body.querySelectorAll('button'))
            .find((button) => button.textContent.includes('Insert'));
        if (!insert) throw new Error('Insert action was not rendered');
        await act(async () => {
            insert.click();
            await Promise.resolve();
        });

        expect(mocks.generateAiContent).toHaveBeenCalledWith({
            context: 'Page context',
            language: null,
            mode: 'continue',
            prompt: null,
        });
        expect(onInsert).toHaveBeenCalledWith('Generated markdown', 'block-1');
        expect(onClose).toHaveBeenCalledOnce();
    });
});
