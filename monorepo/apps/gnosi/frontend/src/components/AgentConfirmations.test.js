import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
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

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, options) => (
            typeof options === 'string'
                ? options
                : options?.defaultValue || key
        ),
    }),
}));

const mountedRoots = [];

const render = async element => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    await act(async () => {
        root.render(element);
    });
    return container;
};

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    while (mountedRoots.length > 0) {
        const { root, container } = mountedRoots.pop();
        await act(async () => root.unmount());
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
        const summaryFor = confirmation => confirmation.action;
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
        expect(reconciled.map(message => message.confirmation.status)).toEqual([
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
        const refresh = vi.fn();
        const clearIntervalFn = vi.fn();
        let scheduled;
        const stop = startConfirmationRefresh(
            refresh,
            (callback, delay) => {
                scheduled = { callback, delay };
                return 42;
            },
            clearIntervalFn,
        );

        expect(refresh).toHaveBeenCalledTimes(1);
        expect(scheduled.delay).toBe(CONFIRMATION_REFRESH_MS);
        scheduled.callback();
        expect(refresh).toHaveBeenCalledTimes(2);
        stop();
        expect(clearIntervalFn).toHaveBeenCalledWith(42);
    });

    it('focuses cancel and disables global Enter confirmation', async () => {
        const onClose = vi.fn();
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        const container = await render(
            React.createElement(ConfirmModal, {
                isOpen: true,
                onClose,
                onConfirm,
                title: 'Review',
                message: 'Exact action',
                confirmText: 'Execute',
                cancelText: 'Cancel',
                confirmOnEnter: false,
                autofocusConfirm: false,
            }),
        );

        const buttons = [...container.querySelectorAll('button')];
        const cancel = buttons.find(button => button.textContent === 'Cancel');
        const execute = buttons.find(button => button.textContent === 'Execute');
        expect(document.activeElement).toBe(cancel);
        expect(cancel.dataset.autofocus).toBe('true');
        expect(execute.dataset.autofocus).toBeUndefined();

        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
            }));
        });
        expect(onConfirm).not.toHaveBeenCalled();

        await act(async () => {
            execute.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('keeps the default export available for the production route', () => {
        expect(AgentChat).toBeTypeOf('function');
    });
});
