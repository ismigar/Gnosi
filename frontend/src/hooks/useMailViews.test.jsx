import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GnosiApiError } from '../shared/api/errors';
import * as mailApi from '../shared/api/mail';
import { useMailViews } from './useMailViews';

vi.mock('../shared/api/mail', () => ({
    createMailView: vi.fn(),
    deleteMailView: vi.fn(),
    fetchMailViews: vi.fn(),
    updateMailView: vi.fn(),
}));

let container;
let hookValueRef;
let root;

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    vi.resetAllMocks();
    mailApi.fetchMailViews.mockResolvedValue([]);
    hookValueRef = { current: null };
});

afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    container = null;
    hookValueRef = null;
    root = null;
});

function Probe({ valueRef }) {
    const value = useMailViews();
    useEffect(() => {
        valueRef.current = value;
    }, [value, valueRef]);
    return null;
}

async function renderHook() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root.render(<Probe valueRef={hookValueRef} />);
        await Promise.resolve();
    });
    await act(async () => Promise.resolve());
}

function httpError() {
    return new GnosiApiError(
        new Response(null, { status: 500, statusText: 'Internal Server Error' }),
        { detail: 'backend failure' },
    );
}

describe('useMailViews', () => {
    it('preserves its public state and mutation behavior with typed API helpers', async () => {
        const initial = { id: 'view-1', name: 'Initial' };
        const created = { id: 'view-2', name: 'Created' };
        const updated = { id: 'view-2', name: 'Updated' };
        mailApi.fetchMailViews.mockResolvedValue([initial]);
        mailApi.createMailView.mockResolvedValue(created);
        mailApi.updateMailView.mockResolvedValue(updated);
        mailApi.deleteMailView.mockResolvedValue(undefined);

        await renderHook();
        expect(hookValueRef.current.loading).toBe(false);
        expect(hookValueRef.current.error).toBeNull();
        expect(hookValueRef.current.views).toEqual([initial]);

        await act(async () => {
            await hookValueRef.current.createView({ name: 'Created' });
        });
        expect(mailApi.createMailView).toHaveBeenCalledWith({ name: 'Created' });
        expect(hookValueRef.current.views).toEqual([initial, created]);

        await act(async () => {
            await hookValueRef.current.updateView('view-2', { name: 'Updated' });
        });
        expect(mailApi.updateMailView).toHaveBeenCalledWith('view-2', { name: 'Updated' });
        expect(hookValueRef.current.views).toEqual([initial, updated]);

        await act(async () => {
            await hookValueRef.current.deleteView('view-1');
        });
        expect(mailApi.deleteMailView).toHaveBeenCalledWith('view-1');
        expect(hookValueRef.current.views).toEqual([updated]);
    });

    it('keeps legacy fetch and mutation error messages for HTTP failures', async () => {
        mailApi.fetchMailViews.mockRejectedValueOnce(httpError());
        await renderHook();
        expect(hookValueRef.current.error).toBe('Error loading views');
        expect(hookValueRef.current.loading).toBe(false);

        mailApi.deleteMailView.mockRejectedValueOnce(httpError());
        await expect(hookValueRef.current.deleteView('view-1'))
            .rejects.toThrow('Error eliminant vista');
    });

    it('keeps the original network error message when loading fails before a response', async () => {
        mailApi.fetchMailViews.mockRejectedValueOnce(new Error('network unavailable'));
        await renderHook();

        expect(hookValueRef.current.error).toBe('network unavailable');
    });
});
