import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
        act(() => {
            insert.click();
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
