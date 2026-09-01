import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppErrorEventDetail } from '../platform/app-events';
import { subscribeAppEvent } from '../platform/app-events';
import { notifyError } from './notifyError';
import { toast } from './toast';

const mocks = vi.hoisted(() => {
    const baseToast = Object.assign(
        vi.fn(() => 'toast-id'),
        {
            custom: vi.fn(() => 'custom-id'),
            dismiss: vi.fn(),
            dismissAll: vi.fn(),
            error: vi.fn(() => 'error-id'),
            loading: vi.fn(() => 'loading-id'),
            promise: vi.fn((promise: Promise<unknown> | (() => Promise<unknown>)) => (
                typeof promise === 'function' ? promise() : promise
            )),
            remove: vi.fn(),
            removeAll: vi.fn(),
            success: vi.fn(() => 'success-id'),
        },
    );
    return {
        baseToast,
        createSystemNotification: vi.fn().mockResolvedValue({}),
    };
});

vi.mock('react-hot-toast', () => ({
    resolveValue: (value: unknown, argument: unknown): unknown => {
        if (typeof value !== 'function') return value;
        const resolver = value as (input: unknown) => unknown;
        return resolver(argument);
    },
    toast: mocks.baseToast,
}));

vi.mock('../api/system', () => ({
    createSystemNotification: mocks.createSystemNotification,
}));

afterEach(() => {
    vi.clearAllMocks();
});

describe('toast and notification infrastructure', () => {
    it('persists qualified toasts and delegates their visual rendering', () => {
        expect(toast.success('Saved from test')).toBe('success-id');

        expect(mocks.baseToast.success).toHaveBeenCalledWith(
            'Saved from test',
            undefined,
        );
        expect(mocks.createSystemNotification).toHaveBeenCalledWith({
            level: 'SUCCESS',
            message: 'Saved from test',
            title: 'UI success',
            workspace_id: 'personal',
        }, true);
    });

    it('emits a typed app error with the backend detail message', () => {
        let received: AppErrorEventDetail | null = null;
        const unsubscribe = subscribeAppEvent('app-error', (detail) => {
            received = detail;
        });

        notifyError('save-test', {
            response: {
                status: 409,
                data: { detail: { message: 'Version conflict' } },
            },
        }, null, { persist: false, silent: true, toast: false });

        expect(received).toMatchObject({
            message: 'Version conflict',
            scope: 'save-test',
            status: 409,
        });
        unsubscribe();
    });

    it('persists loading and resolved promise messages', async () => {
        const pending = Promise.resolve({ id: 'note-1' });

        await toast.promise(pending, {
            loading: 'Saving promise test',
            success: ({ id }) => `Saved ${id}`,
            error: 'Promise failed',
        });
        await Promise.resolve();

        expect(mocks.createSystemNotification).toHaveBeenCalledWith(
            expect.objectContaining({
                level: 'INFO',
                message: 'Saving promise test',
                title: 'UI loading',
            }),
            true,
        );
        expect(mocks.createSystemNotification).toHaveBeenCalledWith(
            expect.objectContaining({
                level: 'SUCCESS',
                message: 'Saved note-1',
                title: 'UI success',
            }),
            true,
        );
    });
});
