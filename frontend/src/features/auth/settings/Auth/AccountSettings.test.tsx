import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import AccountSettings from './AccountSettings';

const mocks = vi.hoisted(() => ({
    changePassword: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    translate: (_key: string, fallback?: string) => fallback ?? _key,
    updateProfile: vi.fn(),
    user: {
        email: 'member@example.test',
        id: 'user-1',
        name: 'Member',
        workspaces: [],
    },
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: mocks.translate }),
}));

vi.mock('../../../../shared/auth/auth-context', () => ({
    useAuth: () => ({
        changePassword: mocks.changePassword,
        updateProfile: mocks.updateProfile,
        user: mocks.user,
    }),
}));

vi.mock('../../../../shared/notifications/toast', () => ({
    toast: { error: mocks.error, success: mocks.success },
}));

vi.mock('../../../../shared/ui/settings/SettingsPrimitives', () => ({
    FormGroup: ({ children, label }: { readonly children: ReactNode; readonly label: string }) => (
        <label>{label}{children}</label>
    ),
    Section: ({ children, title }: { readonly children: ReactNode; readonly title: string }) => (
        <section><h2>{title}</h2>{children}</section>
    ),
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
    mocks.changePassword.mockReset();
    mocks.error.mockReset();
    mocks.success.mockReset();
    mocks.updateProfile.mockReset();
});

async function mountSettings(): Promise<HTMLDivElement> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push({ container, root });
    await act(async () => {
        root.render(<AccountSettings />);
        await Promise.resolve();
    });
    return container;
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

async function submit(form: HTMLFormElement): Promise<void> {
    await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
    });
}

describe('AccountSettings', () => {
    it('updates the typed profile payload after a name change', async () => {
        mocks.updateProfile.mockResolvedValue(mocks.user);
        const container = await mountSettings();
        const nameInput = container.querySelector('input[autocomplete="name"]');
        const profileForm = container.querySelector('form');
        if (!(nameInput instanceof HTMLInputElement)) throw new Error('Missing name input');
        if (!(profileForm instanceof HTMLFormElement)) throw new Error('Missing profile form');
        setInput(nameInput, 'Updated Member');

        await submit(profileForm);

        expect(mocks.updateProfile).toHaveBeenCalledWith({
            current_password: undefined,
            email: undefined,
            name: 'Updated Member',
        });
        expect(mocks.success).toHaveBeenCalledWith('Account updated.');
    });

    it('rejects mismatched passwords and then rotates a valid password', async () => {
        mocks.changePassword.mockResolvedValue(undefined);
        const container = await mountSettings();
        const forms = container.querySelectorAll('form');
        const passwordForm = forms[1];
        if (!(passwordForm instanceof HTMLFormElement)) {
            throw new Error('Missing password form');
        }
        const inputs = passwordForm.querySelectorAll('input');
        const current = inputs[0];
        const next = inputs[1];
        const repeat = inputs[2];
        if (!(current instanceof HTMLInputElement)
            || !(next instanceof HTMLInputElement)
            || !(repeat instanceof HTMLInputElement)) {
            throw new Error('Missing password inputs');
        }
        setInput(current, 'current-password');
        setInput(next, 'new-password');
        setInput(repeat, 'different-password');
        await submit(passwordForm);
        expect(mocks.error).toHaveBeenCalledWith('The new passwords do not match.');
        expect(mocks.changePassword).not.toHaveBeenCalled();

        setInput(repeat, 'new-password');
        await submit(passwordForm);
        expect(mocks.changePassword).toHaveBeenCalledWith(
            'current-password',
            'new-password',
        );
    });
});
