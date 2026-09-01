import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { LoginPage } from './LoginPage';

const mocks = vi.hoisted(() => ({
    login: vi.fn(),
    register: vi.fn(),
    success: vi.fn(),
    translate: (_key: string, fallback?: string) => fallback ?? _key,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: mocks.translate }),
}));

vi.mock('../../shared/auth/auth-context', () => ({
    useAuth: () => ({ login: mocks.login, register: mocks.register }),
}));

vi.mock('../../shared/notifications/toast', () => ({
    toast: { success: mocks.success },
}));

const roots: Array<{ readonly container: HTMLDivElement; readonly root: Root }> = [];
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    while (roots.length > 0) {
        const mounted = roots.pop();
        if (!mounted) break;
        act(() => {
            mounted.root.unmount();
        });
        mounted.container.remove();
    }
    mocks.login.mockReset();
    mocks.register.mockReset();
    mocks.success.mockReset();
});

async function mountLoginPage(): Promise<HTMLDivElement> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push({ container, root });
    await act(async () => {
        root.render(<LoginPage />);
        await Promise.resolve();
    });
    return container;
}

function requiredInput(container: ParentNode, type: string): HTMLInputElement {
    const input = container.querySelector(`input[type="${type}"]`);
    if (!(input instanceof HTMLInputElement)) throw new Error(`Missing ${type} input`);
    return input;
}

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

async function submit(container: ParentNode): Promise<void> {
    const form = container.querySelector('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('Missing auth form');
    await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
    });
}

describe('LoginPage', () => {
    it('submits the typed login contract and reports success', async () => {
        mocks.login.mockResolvedValue({ id: 'user-1' });
        const container = await mountLoginPage();
        setInput(requiredInput(container, 'email'), 'member@example.test');
        setInput(requiredInput(container, 'password'), 'password-1');

        await submit(container);

        expect(mocks.login).toHaveBeenCalledWith(
            'member@example.test',
            'password-1',
        );
        expect(mocks.success).toHaveBeenCalledWith('Signed in.');
    });

    it('validates registration before submitting the optional name', async () => {
        mocks.register.mockResolvedValue({ id: 'user-1' });
        const container = await mountLoginPage();
        const switchButton = Array.from(container.querySelectorAll('button'))
            .find((button) => button.type === 'button');
        if (!switchButton) throw new Error('Missing registration toggle');
        act(() => {
            switchButton.click();
        });

        setInput(requiredInput(container, 'email'), 'member@example.test');
        setInput(requiredInput(container, 'password'), 'short');
        await submit(container);
        expect(container.querySelector('[role="alert"]')?.textContent)
            .toContain('at least 8 characters');
        expect(mocks.register).not.toHaveBeenCalled();

        setInput(requiredInput(container, 'text'), 'Member');
        setInput(requiredInput(container, 'password'), 'password-1');
        await submit(container);
        expect(mocks.register).toHaveBeenCalledWith(
            'member@example.test',
            'password-1',
            'Member',
        );
    });
});
