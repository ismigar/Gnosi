import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import MailComposer from './MailComposer';

const mocks = vi.hoisted(() => {
    const toast = vi.fn();
    toast.success = vi.fn();
    toast.error = vi.fn();
    return {
        deleteMailDraft: vi.fn(),
        generateMailDraft: vi.fn(),
        replyMailMultipart: vi.fn(),
        saveMailDraft: vi.fn(),
        sendMailMultipart: vi.fn(),
        toast,
    };
});

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, fallback) => fallback || key,
    }),
}));

vi.mock('../../lib/toast', () => ({ toast: mocks.toast }));

vi.mock('../../shared/api/mail', () => ({
    deleteMailDraft: mocks.deleteMailDraft,
    generateMailDraft: mocks.generateMailDraft,
    saveMailDraft: mocks.saveMailDraft,
}));

vi.mock('../../shared/api/mail-specialized', () => ({
    replyMailMultipart: mocks.replyMailMultipart,
    sendMailMultipart: mocks.sendMailMultipart,
}));

vi.mock('../../shared/api/legacy-http', () => ({
    default: { get: vi.fn() },
}));

vi.mock('./MailAddressInput', () => ({
    AddressInput: ({ label, onChange, value }) => (
        <input
            aria-label={label}
            value={value}
            onChange={(event) => onChange(event.target.value)}
        />
    ),
}));

vi.mock('./MailBlockEditor', () => ({
    default: ({ editorRef, onChange }) => {
        editorRef.current = {
            replaceBlocks: vi.fn(),
        };
        return (
            <textarea
                aria-label="mail-body"
                onChange={(event) => onChange(event.target.value)}
            />
        );
    },
}));

vi.mock('../Vault/DigitalBrainCalendar', () => ({
    DigitalBrainCalendar: () => null,
}));

vi.mock('../../hooks/useModalKeyboard', () => ({
    useModalKeyboard: vi.fn(),
}));

const mountedRoots = [];

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteMailDraft.mockResolvedValue({ status: 'success' });
    mocks.generateMailDraft.mockResolvedValue({ draft: 'Generated reply' });
    mocks.replyMailMultipart.mockResolvedValue({ status: 'success' });
    mocks.saveMailDraft.mockResolvedValue({
        draft_id: 'draft-saved',
        status: 'success',
    });
    mocks.sendMailMultipart.mockResolvedValue({ status: 'success' });
});

afterEach(async () => {
    while (mountedRoots.length) {
        const { container, root } = mountedRoots.pop();
        await act(async () => root.unmount());
        container.remove();
    }
    vi.useRealTimers();
});

function renderComposer(props = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });
    const account = {
        display_name: 'Ada Lovelace',
        email: 'ada@example.test',
        signature: '<p>Ada</p>',
        smtp_email: 'smtp@example.test',
    };

    act(() => {
        root.render(
            <MailComposer
                account={account}
                accounts={[account]}
                onClose={vi.fn()}
                {...props}
            />,
        );
    });
    return { container };
}

function changeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonContaining(container, text) {
    const button = [...container.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(text));
    expect(button).toBeTruthy();
    return button;
}

describe('MailComposer shared Mail API migration', () => {
    it('auto-saves the current draft and reports only the first successful save', async () => {
        vi.useFakeTimers();
        const onDraftSaved = vi.fn();
        renderComposer({ initialSubject: 'Analytical engine', onDraftSaved });

        await act(async () => {
            vi.advanceTimersByTime(2000);
            await Promise.resolve();
        });

        expect(mocks.saveMailDraft).toHaveBeenCalledWith({
            account: 'ada@example.test',
            bcc: '',
            body: '',
            cc: '',
            draft_id: undefined,
            subject: 'Analytical engine',
            to: '',
        });
        expect(onDraftSaved).toHaveBeenCalledOnce();
        expect(mocks.toast).toHaveBeenCalledWith('mail.draft_saved', {
            duration: 1500,
            icon: '💾',
        });
    });

    it('sends the original FormData and clears the saved draft after success', async () => {
        const onClose = vi.fn();
        const onDraftSaved = vi.fn();
        const onSent = vi.fn();
        const { container } = renderComposer({
            _draftId: 'draft-existing',
            initialSubject: 'Notes',
            initialTo: 'charles@example.test',
            onClose,
            onDraftSaved,
            onSent,
        });
        const body = container.querySelector('textarea[aria-label="mail-body"]');
        const fileInput = container.querySelector('input[type="file"]');
        const attachment = new File(['engine'], 'engine.txt', { type: 'text/plain' });

        await act(async () => {
            changeValue(body, '<p>Hello</p>');
            Object.defineProperty(fileInput, 'files', {
                configurable: true,
                value: [attachment],
            });
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () => {
            buttonContaining(container, 'mail.send_btn')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.sendMailMultipart).toHaveBeenCalledOnce();
        const [email, formData] = mocks.sendMailMultipart.mock.calls[0];
        expect(email).toBe('smtp@example.test');
        expect(formData.get('to')).toBe('charles@example.test');
        expect(formData.get('subject')).toBe('Notes');
        expect(formData.get('body')).toBe(
            '<p>Hello</p><div style="margin-top:1rem"><p>Ada</p></div>',
        );
        expect(formData.get('from_email')).toBe('ada@example.test');
        expect(formData.get('from_name')).toBe('Ada Lovelace');
        expect(formData.get('attachments')).toBe(attachment);
        expect(mocks.deleteMailDraft).toHaveBeenCalledWith('draft-existing');
        expect(onDraftSaved).toHaveBeenCalledOnce();
        expect(onSent).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('generates the body through the typed API and replies through multipart', async () => {
        const { container } = renderComposer({
            initialSubject: 'Meeting',
            initialTo: 'charles@example.test',
            mode: 'reply',
            replyToMessageId: 'message/42',
            sourceFolder: 'Sent Items',
        });
        const body = container.querySelector('textarea[aria-label="mail-body"]');

        await act(async () => {
            changeValue(body, 'Original context');
            buttonContaining(container, 'mail.ai_draft')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mocks.generateMailDraft).toHaveBeenCalledWith(
            'Original context',
            'Create a professional draft about: Meeting',
        );

        await act(async () => {
            buttonContaining(container, 'mail.send_btn')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.replyMailMultipart).toHaveBeenCalledOnce();
        const [messageId, email, folder, formData] = mocks.replyMailMultipart.mock.calls[0];
        expect(messageId).toBe('message/42');
        expect(email).toBe('smtp@example.test');
        expect(folder).toBe('Sent Items');
        expect(formData.get('body')).toBe('Generated reply');
        expect(mocks.sendMailMultipart).not.toHaveBeenCalled();
    });
});
