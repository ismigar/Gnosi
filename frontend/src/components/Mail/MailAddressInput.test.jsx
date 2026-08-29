import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { fetchMailRecipientSuggestions } from '../../shared/api/mail';
import { AddressInput } from './MailAddressInput';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, fallback, values = {}) => Object.entries(values).reduce(
            (text, [name, value]) => text.replace(`{{${name}}}`, value),
            fallback || key,
        ),
    }),
}));

vi.mock('../../shared/api/mail', () => ({
    fetchMailRecipientSuggestions: vi.fn(),
}));

let container;
let root;

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.React = React;
});

afterAll(() => {
    delete globalThis.React;
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
});

afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.useRealTimers();
});

async function renderInput(props = {}) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root.render(
            <AddressInput
                accountEmail="owner@example.test"
                label="To"
                onChange={() => {}}
                placeholder="Recipients"
                value=""
                {...props}
            />,
        );
    });
    return container.querySelector('input');
}

async function typeAndDebounce(input, value) {
    await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
        ).set;
        valueSetter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
        vi.advanceTimersByTime(280);
        await Promise.resolve();
    });
}

describe('AddressInput', () => {
    it('normalizes separators and loads typed recipient suggestions after the existing debounce', async () => {
        const onChange = vi.fn();
        fetchMailRecipientSuggestions.mockResolvedValue({
            suggestions: [
                { email: 'bob@example.test', freq: 3, name: 'Bob', source: 'mail' },
            ],
            group_suggestions: [
                { email: 'grace@example.test', freq: 1, name: 'Grace', source: 'mail' },
            ],
        });
        const input = await renderInput({ onChange });

        await typeAndDebounce(input, 'ada@example.test; bo');

        expect(onChange).toHaveBeenCalledWith('ada@example.test, bo');
        expect(fetchMailRecipientSuggestions).toHaveBeenCalledWith(
            'bo',
            'owner@example.test',
        );
        expect(container.textContent).toContain('Bob');
        expect(container.textContent).toContain('Grace');
        expect(container.textContent).toContain('Usual group');
    });

    it('keeps suggestion failures silent and omits an empty account selector', async () => {
        fetchMailRecipientSuggestions.mockRejectedValue(new Error('offline'));
        const input = await renderInput({ accountEmail: '' });

        await typeAndDebounce(input, 'ad');

        expect(fetchMailRecipientSuggestions).toHaveBeenCalledWith('ad', undefined);
        expect(container.querySelector('[class*="z-modal-dropdown"]')).toBeNull();
    });
});
