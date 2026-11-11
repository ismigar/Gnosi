import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecurrenceChoiceModal } from './RecurrenceChoiceModal';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback: string): string => fallback,
    }),
}));

function findButton(label: string): HTMLButtonElement {
    const button = [...document.body.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(label));
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button: ${label}`);
    }
    return button;
}

describe('RecurrenceChoiceModal', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('preserves the instance, following, series, and cancel contracts', () => {
        const onClose = vi.fn<() => void>();
        const onConfirm = vi.fn<(
            isSeries: boolean,
            isInstanceOnly: boolean,
            isFollowing: boolean,
        ) => void>();
        act(() => {
            root.render(
                <RecurrenceChoiceModal
                    actionType="delete"
                    isOpen
                    message="Choose scope"
                    onClose={onClose}
                    onConfirm={onConfirm}
                    title="Delete recurring event"
                />,
            );
        });

        act(() => {
            findButton('Only this instance').click();
            findButton('This and following').click();
            findButton('Entire series').click();
            findButton('Cancel').click();
        });

        expect(onConfirm.mock.calls).toEqual([
            [false, true, false],
            [false, false, true],
            [true, false, false],
        ]);
        expect(onClose).toHaveBeenCalledOnce();
    });
});
