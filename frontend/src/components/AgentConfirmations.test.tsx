import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import AgentChat from './AgentChat';
import ConfirmModal from './ConfirmModal';
import {
    CONFIRMATION_REFRESH_MS,
    agentChatStorageScope,
    confirmationForStorage,
    mergeConfirmationRecords,
    startConfirmationRefresh,
} from './agentConfirmationUtils';
import type { ConfirmationRecord } from './agentConfirmationUtils';

interface MountedRoot {
    readonly container: HTMLDivElement;
    readonly root: Root;
}

interface TestConfirmation extends ConfirmationRecord {
    readonly action: string;
    readonly status?: string;
}

interface ScheduledRefresh {
    readonly callback: Parameters<
        NonNullable<Parameters<typeof startConfirmationRefresh>[1]>
    >[0];
    readonly delay: number;
}

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (
            key: string,
            options?: string | { readonly defaultValue?: string },
        ) => (
            typeof options === 'string'
                ? options
                : options?.defaultValue || key
        ),
    }),
}));

const mountedRoots: MountedRoot[] = [];

const render = async (element: ReactElement): Promise<HTMLDivElement> => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    await act(async () => {
        root.render(element);
        await Promise.resolve();
    });
    return container;
};

const getButton = (container: HTMLElement, label: string): HTMLButtonElement => {
    const button = Array.from(container.querySelectorAll('button'))
        .find((candidate) => candidate.textContent === label);
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Button not found: ${label}`);
    }
    return button;
};

beforeAll(() => {
    const reactTestGlobal = globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) continue;
        const { root, container } = mounted;
        await act(async () => {
            root.unmount();
            await Promise.resolve();
        });
        container.remove();
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('agent action confirmations', () => {
    it('isolates browser chat storage by vault, workspace, and user', () => {
        const first = agentChatStorageScope({
            vaultId: 'vault-a',
            workspaceId: 'workspace-a',
            userId: 'user-a',
        });
        expect(first).not.toBe(agentChatStorageScope({
            vaultId: 'vault-a',
            workspaceId: 'workspace-a',
            userId: 'user-b',
        }));
        expect(first).not.toBe(agentChatStorageScope({
            vaultId: 'vault-a',
            workspaceId: 'workspace-b',
            userId: 'user-a',
        }));
        expect(first).not.toBe(agentChatStorageScope({
            vaultId: 'vault-b',
            workspaceId: 'workspace-a',
            userId: 'user-a',
        }));
    });

    it('keeps independent cards and reconciles each status by id', () => {
        const summaryFor = (confirmation: TestConfirmation): string => (
            confirmation.action
        );
        const firstPass = mergeConfirmationRecords(
            [],
            [
                {
                    confirmation_id: 'first',
                    action: 'send_mail',
                    status: 'pending',
                },
                {
                    confirmation_id: 'second',
                    action: 'empty_trash',
                    status: 'pending',
                },
            ],
            summaryFor,
        );
        const reconciled = mergeConfirmationRecords(
            firstPass,
            [
                {
                    confirmation_id: 'first',
                    action: 'send_mail',
                    status: 'completed',
                },
                {
                    confirmation_id: 'second',
                    action: 'empty_trash',
                    status: 'partial',
                },
            ],
            summaryFor,
        );

        expect(reconciled).toHaveLength(2);
        expect(reconciled.map((message) => message.confirmation?.status)).toEqual([
            'completed',
            'partial',
        ]);
    });

    it('never persists exact confirmation details in browser storage', () => {
        expect(confirmationForStorage({
            confirmation_id: 'mail',
            action: 'send_mail',
            summary_key: 'chat.confirmations.actions.send_mail.summary',
            details: {
                to: 'person@example.com',
                body: 'sensitive body',
            },
        })).toEqual({
            confirmation_id: 'mail',
            action: 'send_mail',
            summary_key: 'chat.confirmations.summary',
            details: {},
        });
    });

    it('refreshes confirmation state immediately and on the fixed interval', () => {
        const refresh = vi.fn<() => void>();
        const clearIntervalFn = vi.fn<
            (handle: ReturnType<typeof globalThis.setInterval>) => void
        >();
        let scheduled: ScheduledRefresh | undefined;
        const timerHandle = 42 as unknown as ReturnType<
            typeof globalThis.setInterval
        >;
        const stop = startConfirmationRefresh(
            refresh,
            (callback, delay) => {
                scheduled = { callback, delay };
                return timerHandle;
            },
            clearIntervalFn,
        );

        expect(refresh).toHaveBeenCalledTimes(1);
        expect(scheduled?.delay).toBe(CONFIRMATION_REFRESH_MS);
        if (!scheduled) throw new Error('Refresh interval was not scheduled');
        void scheduled.callback();
        expect(refresh).toHaveBeenCalledTimes(2);
        stop();
        expect(clearIntervalFn).toHaveBeenCalledWith(timerHandle);
    });

    it('focuses cancel and disables global Enter confirmation', async () => {
        const onClose = vi.fn();
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        const container = await render(
            <ConfirmModal
                isOpen
                onClose={onClose}
                onConfirm={onConfirm}
                title="Review"
                message="Exact action"
                confirmText="Execute"
                cancelText="Cancel"
                confirmOnEnter={false}
                autofocusConfirm={false}
            />,
        );

        const cancel = getButton(container, 'Cancel');
        const execute = getButton(container, 'Execute');
        expect(document.activeElement).toBe(cancel);
        expect(cancel.dataset.autofocus).toBe('true');
        expect(execute.dataset.autofocus).toBeUndefined();

        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
            }));
            await Promise.resolve();
        });
        expect(onConfirm).not.toHaveBeenCalled();

        await act(async () => {
            execute.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('requires the acknowledgement checkbox before confirming', async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        const container = await render(
            <ConfirmModal
                isOpen
                onClose={vi.fn()}
                onConfirm={onConfirm}
                title="Review"
                message="Exact action"
                confirmText="Execute"
                cancelText="Cancel"
                requireAcknowledgement
                acknowledgementLabel="I reviewed it"
            />,
        );

        const checkbox = container.querySelector<HTMLInputElement>(
            'input[type="checkbox"]',
        );
        const execute = getButton(container, 'Execute');
        expect(checkbox).not.toBeNull();
        expect(execute.disabled).toBe(true);
        if (!checkbox) throw new Error('Acknowledgement checkbox not found');

        await act(async () => {
            checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
        });
        expect(execute.disabled).toBe(false);

        await act(async () => {
            execute.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('keeps the default export available for the production route', () => {
        expect(AgentChat).toBeTypeOf('function');
    });
});
