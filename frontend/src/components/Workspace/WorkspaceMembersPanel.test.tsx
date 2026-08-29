import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceMembersPanel } from './WorkspaceMembersPanel';


type WorkspaceApi = typeof import('../../shared/api/workspace-members');


interface ConfirmModalStubProps {
    readonly isOpen: boolean;
    readonly onConfirm: () => unknown;
}


const mocks = vi.hoisted(() => ({
    fetchWorkspaceMembers: vi.fn<WorkspaceApi['fetchWorkspaceMembers']>(),
    fetchWorkspaceMemberVaults: vi.fn<WorkspaceApi['fetchWorkspaceMemberVaults']>(),
    fetchWorkspaceVaults: vi.fn<WorkspaceApi['fetchWorkspaceVaults']>(),
    grantWorkspaceMemberVault: vi.fn<WorkspaceApi['grantWorkspaceMemberVault']>(),
    inviteWorkspaceMember: vi.fn<WorkspaceApi['inviteWorkspaceMember']>(),
    removeWorkspaceMember: vi.fn<WorkspaceApi['removeWorkspaceMember']>(),
    revokeWorkspaceMemberVault: vi.fn<WorkspaceApi['revokeWorkspaceMemberVault']>(),
    updateWorkspaceMemberRole: vi.fn<WorkspaceApi['updateWorkspaceMemberRole']>(),
    toastError: vi.fn<(message: unknown) => void>(),
    toastSuccess: vi.fn<(message: unknown) => void>(),
}));

const translate = vi.hoisted(() => (
    key: string,
    fallback?: string | { readonly defaultValue?: string },
): string => typeof fallback === 'string'
    ? fallback
    : fallback?.defaultValue ?? key);


vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));

vi.mock('../../shared/api/workspace-members', () => ({
    fetchWorkspaceMembers: mocks.fetchWorkspaceMembers,
    fetchWorkspaceMemberVaults: mocks.fetchWorkspaceMemberVaults,
    fetchWorkspaceVaults: mocks.fetchWorkspaceVaults,
    grantWorkspaceMemberVault: mocks.grantWorkspaceMemberVault,
    inviteWorkspaceMember: mocks.inviteWorkspaceMember,
    removeWorkspaceMember: mocks.removeWorkspaceMember,
    revokeWorkspaceMemberVault: mocks.revokeWorkspaceMemberVault,
    updateWorkspaceMemberRole: mocks.updateWorkspaceMemberRole,
}));

vi.mock('../../lib/toast', () => ({
    toast: {
        error: mocks.toastError,
        success: mocks.toastSuccess,
    },
}));

vi.mock('../ConfirmModal', () => ({
    default: ({ isOpen, onConfirm }: ConfirmModalStubProps) => isOpen ? (
        <button
            data-testid="confirm-remove"
            onClick={() => {
                void onConfirm();
            }}
        >
            Confirm remove
        </button>
    ) : null,
}));


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


describe('WorkspaceMembersPanel', () => {
    let container: HTMLDivElement;
    let root: Root;

    const member = {
        email: 'member@example.test',
        joined_at: '2026-01-02T00:00:00Z',
        role: 'viewer',
        user_id: 'member-1',
    };

    const operation = { message: 'ok', status: 'success' };

    const settle = async (): Promise<void> => {
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
    };

    const renderPanel = async (): Promise<void> => {
        await act(async () => {
            root.render(
                <WorkspaceMembersPanel
                    currentUserId="admin-1"
                    isAdmin
                    workspaceId="workspace-1"
                />,
            );
            await Promise.resolve();
        });
        await settle();
    };

    const buttonByText = (text: string): HTMLButtonElement => {
        const button = Array.from(container.querySelectorAll('button'))
            .find((candidate) => candidate.textContent.trim() === text);
        if (!button) throw new Error(`Button missing: ${text}`);
        return button;
    };

    const buttonByTitle = (title: string): HTMLButtonElement => {
        const button = container.querySelector<HTMLButtonElement>(
            `button[title="${title}"]`,
        );
        if (!button) throw new Error(`Button missing: ${title}`);
        return button;
    };

    const click = async (element: HTMLElement): Promise<void> => {
        await act(async () => {
            element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });
    };

    const change = async (
        element: HTMLInputElement | HTMLSelectElement,
        value: string,
    ): Promise<void> => {
        const prototype = element instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
        await act(async () => {
            Reflect.set(prototype, 'value', value, element);
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new Event('input', { bubbles: true }));
            await Promise.resolve();
        });
    };

    beforeAll(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.fetchWorkspaceMembers.mockResolvedValue([member]);
        mocks.fetchWorkspaceVaults.mockResolvedValue([{ id: 'vault-1', name: 'Vault' }]);
        mocks.fetchWorkspaceMemberVaults.mockResolvedValue([]);
        mocks.grantWorkspaceMemberVault.mockResolvedValue(operation);
        mocks.inviteWorkspaceMember.mockResolvedValue(operation);
        mocks.removeWorkspaceMember.mockResolvedValue(operation);
        mocks.revokeWorkspaceMemberVault.mockResolvedValue(operation);
        mocks.updateWorkspaceMemberRole.mockResolvedValue(operation);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
            await Promise.resolve();
        });
        container.remove();
    });

    it('loads members and invites a typed viewer', async () => {
        await renderPanel();
        expect(container.textContent).toContain('member@example.test');

        await click(buttonByText('Invite'));
        const email = container.querySelector<HTMLInputElement>('input[type="email"]');
        if (!email) throw new Error('Invite email input is missing');
        await change(email, 'new@example.test');
        await click(buttonByText('OK'));

        expect(mocks.inviteWorkspaceMember).toHaveBeenCalledWith('workspace-1', {
            email: 'new@example.test',
            role: 'viewer',
        });
    });

    it('updates a member role with its capability contract', async () => {
        await renderPanel();
        const role = container.querySelector<HTMLSelectElement>('tbody select');
        if (!role) throw new Error('Member role selector is missing');

        await change(role, 'editor');

        expect(mocks.updateWorkspaceMemberRole).toHaveBeenCalledWith(
            'workspace-1',
            'member-1',
            { role: 'editor', permissions: { capabilities: ['read', 'write'] } },
        );
    });

    it('confirms member removal before calling the shared API', async () => {
        await renderPanel();
        await click(buttonByTitle('Remove'));
        expect(mocks.removeWorkspaceMember).not.toHaveBeenCalled();

        const confirm = container.querySelector<HTMLButtonElement>(
            '[data-testid="confirm-remove"]',
        );
        if (!confirm) throw new Error('Removal confirmation is missing');
        await click(confirm);

        expect(mocks.removeWorkspaceMember).toHaveBeenCalledWith(
            'workspace-1',
            'member-1',
        );
    });

    it('grants and revokes access for the selected member', async () => {
        await renderPanel();
        await click(buttonByTitle('Manage Vault access'));
        await settle();
        await click(buttonByText('Grant'));
        expect(mocks.grantWorkspaceMemberVault).toHaveBeenCalledWith(
            'workspace-1',
            'member-1',
            { vault_id: 'vault-1', permissions: { capabilities: ['read'] } },
        );

        mocks.fetchWorkspaceMemberVaults.mockResolvedValue([{
            permissions: { capabilities: ['read'] },
            vault_id: 'vault-1',
            vault_name: 'Vault',
        }]);
        const closeAccess = container.querySelector<HTMLButtonElement>(
            '.mt-3 > .flex button',
        );
        if (!closeAccess) throw new Error('Vault access close button is missing');
        await click(closeAccess);
        await click(buttonByTitle('Manage Vault access'));
        await settle();
        await click(buttonByText('Has access'));
        expect(mocks.revokeWorkspaceMemberVault).toHaveBeenCalledWith(
            'workspace-1',
            'member-1',
            'vault-1',
        );
    });
});
