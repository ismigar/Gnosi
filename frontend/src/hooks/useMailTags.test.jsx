import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GnosiApiError } from '../shared/api/errors';
import * as mailApi from '../shared/api/mail';
import { MailTagsProvider, useMailTags } from './useMailTags';

vi.mock('../shared/api/mail', () => ({
    createMailTag: vi.fn(),
    deleteMailTag: vi.fn(),
    fetchMailMessageTags: vi.fn(),
    fetchMailTags: vi.fn(),
    fetchTaggedMailMessages: vi.fn(),
    fetchTagsForMailMessages: vi.fn(),
    setMailMessageTags: vi.fn(),
    updateMailTag: vi.fn(),
}));

let container;
let hookValueRef;
let root;

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    vi.resetAllMocks();
    mailApi.fetchMailTags.mockResolvedValue([]);
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
    const value = useMailTags();
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
        root.render(
            <MailTagsProvider>
                <Probe valueRef={hookValueRef} />
            </MailTagsProvider>,
        );
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

describe('useMailTags', () => {
    it('keeps the public state and mutation behavior while delegating to mail API helpers', async () => {
        const initial = { id: 'tag-1', name: 'Initial', color: '#111111' };
        const created = { id: 'tag-2', name: 'Created', color: '#222222' };
        const updated = { ...created, name: 'Updated' };
        mailApi.fetchMailTags.mockResolvedValue([initial]);
        mailApi.createMailTag.mockResolvedValue(created);
        mailApi.updateMailTag.mockResolvedValue(updated);
        mailApi.deleteMailTag.mockResolvedValue(undefined);
        mailApi.setMailMessageTags.mockResolvedValue({ status: 'success', tag_ids: ['tag-2'] });

        await renderHook();
        expect(hookValueRef.current.loading).toBe(false);
        expect(hookValueRef.current.tags).toEqual([initial]);

        await act(async () => {
            await hookValueRef.current.createTag({ name: 'Created', color: '#222222' });
        });
        expect(mailApi.createMailTag).toHaveBeenCalledWith({
            name: 'Created',
            color: '#222222',
        });
        expect(hookValueRef.current.tags).toEqual([initial, created]);

        await act(async () => {
            await hookValueRef.current.updateTag('tag-2', {
                name: 'Updated',
                color: '#222222',
            });
        });
        expect(mailApi.updateMailTag).toHaveBeenCalledWith('tag-2', {
            name: 'Updated',
            color: '#222222',
        });
        expect(hookValueRef.current.tags).toEqual([initial, updated]);

        await hookValueRef.current.setMessageTags('message-1', ['tag-2'], {
            account_email: 'ada@example.test',
            date: '2026-08-29',
            sender: 'Grace',
            subject: 'Research',
        });
        expect(mailApi.setMailMessageTags).toHaveBeenCalledWith('message-1', {
            account_email: 'ada@example.test',
            date_str: '2026-08-29',
            sender: 'Grace',
            subject: 'Research',
            tag_ids: ['tag-2'],
        });

        await act(async () => {
            await hookValueRef.current.deleteTag('tag-1');
        });
        expect(mailApi.deleteMailTag).toHaveBeenCalledWith('tag-1');
        expect(hookValueRef.current.tags).toEqual([updated]);
    });

    it('preserves HTTP fallbacks and rethrows network failures', async () => {
        await renderHook();
        mailApi.fetchMailMessageTags.mockRejectedValueOnce(httpError());
        mailApi.fetchTaggedMailMessages.mockRejectedValueOnce(httpError());
        mailApi.fetchTagsForMailMessages.mockRejectedValueOnce(httpError());

        await expect(hookValueRef.current.getMessageTags('message-1')).resolves.toEqual([]);
        await expect(hookValueRef.current.getTaggedMessages('tag-1')).resolves.toEqual({
            tag: null,
            messages: [],
        });
        await expect(hookValueRef.current.getBatchMessageTags(['message-1']))
            .resolves.toEqual({});

        const networkError = new Error('network unavailable');
        mailApi.fetchMailMessageTags.mockRejectedValueOnce(networkError);
        await expect(hookValueRef.current.getMessageTags('message-2'))
            .rejects.toBe(networkError);
    });

    it('keeps legacy mutation errors for HTTP failures', async () => {
        await renderHook();
        mailApi.createMailTag.mockRejectedValueOnce(httpError());

        await expect(hookValueRef.current.createTag({ name: 'Broken', color: '#000000' }))
            .rejects.toThrow('Error creant etiqueta');
    });
});
