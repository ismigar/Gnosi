import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiTokenCreated, ApiTokenSummary } from '../../../shared/api/tokens';
import ApiTokensSettings from './ApiTokensSettings';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

interface ConfirmModalMockProps {
    readonly isOpen: boolean;
    readonly onConfirm: () => unknown;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const existingToken: ApiTokenSummary = {
    created_at: '2026-08-28T10:00:00Z',
    id: 'token-existing',
    last_used_at: null,
    name: 'Existing clipper',
    prefix: 'gn_existing',
    scopes: 'read,write',
};
const createdToken: ApiTokenCreated = {
    created_at: '2026-08-29T10:00:00Z',
    id: 'token-new',
    name: 'Web clipper',
    prefix: 'gn_new',
    scopes: 'read,write',
    token: 'gnosi-secret-once',
};
const testState = vi.hoisted(() => ({
    copy: vi.fn<(text: string) => Promise<void>>(),
    createApiToken: vi.fn<(name: string) => Promise<ApiTokenCreated>>(),
    fetchApiTokens: vi.fn<() => Promise<ApiTokenSummary[]>>(),
    revokeApiToken: vi.fn<(tokenId: string) => Promise<unknown>>(),
}));

vi.mock('../../../shared/api/tokens', () => ({
    createApiToken: testState.createApiToken,
    fetchApiTokens: testState.fetchApiTokens,
    revokeApiToken: testState.revokeApiToken,
}));

vi.mock('../../../shared/i18n/i18n', () => ({
    default: { language: 'en' },
}));

vi.mock('react-i18next', () => ({
    Trans: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
    useTranslation: () => ({
        t: (key: string, fallback: string): string => fallback || key,
    }),
}));

vi.mock('../../../shared/ui/dialogs/ConfirmModal', () => ({
    ConfirmModal: ({ isOpen, onConfirm }: ConfirmModalMockProps) => (
        isOpen ? (
            <button
                type="button"
                data-testid="confirm-revoke"
                onClick={() => {
                    onConfirm();
                }}
            >
                Confirm revoke
            </button>
        ) : null
    ),
}));

function setInput(input: HTMLInputElement, value: string): void {
    act(() => {
        const setValue = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
        )?.set?.bind(input);
        if (!setValue) throw new Error('Missing native input value setter');
        setValue(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

describe('ApiTokensSettings', () => {
    let clipboardDescriptor: PropertyDescriptor | undefined;
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        testState.copy.mockReset();
        testState.createApiToken.mockReset();
        testState.fetchApiTokens.mockReset();
        testState.revokeApiToken.mockReset();
        testState.copy.mockResolvedValue(undefined);
        testState.createApiToken.mockResolvedValue(createdToken);
        testState.fetchApiTokens.mockResolvedValue([existingToken]);
        testState.revokeApiToken.mockResolvedValue({});
        clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: testState.copy },
        });
    });

    afterEach(() => {
        act(() => {
            vi.runOnlyPendingTimers();
            root.unmount();
        });
        container.remove();
        if (clipboardDescriptor) {
            Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
        } else {
            Reflect.deleteProperty(navigator, 'clipboard');
        }
        vi.useRealTimers();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('creates, copies, reloads, and revokes API tokens', async () => {
        await act(async () => {
            root.render(<ApiTokensSettings />);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(container.textContent).toContain('Existing clipper');

        const nameInput = container.querySelector('input');
        if (!(nameInput instanceof HTMLInputElement)) throw new Error('Missing token name input');
        setInput(nameInput, '  Web clipper  ');
        const createButton = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Create'));
        if (!(createButton instanceof HTMLButtonElement)) throw new Error('Missing create button');
        await act(async () => {
            createButton.click();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(testState.createApiToken).toHaveBeenCalledWith('Web clipper');
        expect(testState.fetchApiTokens).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('gnosi-secret-once');

        const copyButton = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Copy'));
        if (!(copyButton instanceof HTMLButtonElement)) throw new Error('Missing copy button');
        await act(async () => {
            copyButton.click();
            await Promise.resolve();
        });
        expect(testState.copy).toHaveBeenCalledWith('gnosi-secret-once');
        expect(container.textContent).toContain('Copied');

        const revokeButton = container.querySelector('button[title="Revoke"]');
        if (!(revokeButton instanceof HTMLButtonElement)) throw new Error('Missing revoke button');
        act(() => {
            revokeButton.click();
        });
        const confirmButton = container.querySelector('[data-testid="confirm-revoke"]');
        if (!(confirmButton instanceof HTMLButtonElement)) throw new Error('Missing revoke confirmation');
        await act(async () => {
            confirmButton.click();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(testState.revokeApiToken).toHaveBeenCalledWith('token-existing');
        expect(testState.fetchApiTokens).toHaveBeenCalledTimes(3);
    });
});
