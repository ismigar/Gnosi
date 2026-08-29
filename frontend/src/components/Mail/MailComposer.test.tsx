import { act, type ComponentType, type ChangeEvent, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import MailComposer from './MailComposer';


type DeleteMailDraft = typeof import('../../shared/api/mail').deleteMailDraft;
type GenerateMailDraft = typeof import('../../shared/api/mail').generateMailDraft;
type SaveMailDraft = typeof import('../../shared/api/mail').saveMailDraft;
type ReplyMailMultipart = typeof import('../../shared/api/mail-specialized').replyMailMultipart;
type SendMailMultipart = typeof import('../../shared/api/mail-specialized').sendMailMultipart;
type ToastMockCall = (message: unknown, options?: unknown) => unknown;

interface MailComposerAccount {
    readonly display_name?: string | null;
    readonly email?: string | null;
    readonly name?: string | null;
    readonly signature?: string | null;
    readonly smtp_email?: string | null;
    readonly username?: string | null;
}

interface MailComposerProps {
    readonly _draftId?: string | null;
    readonly account?: MailComposerAccount | null;
    readonly accounts?: readonly MailComposerAccount[];
    readonly initialBody?: string;
    readonly initialCc?: string;
    readonly initialSubject?: string;
    readonly initialTo?: string;
    readonly mode?: 'forward' | 'reply' | 'reply_all' | null;
    readonly onClose: () => void;
    readonly onDraftSaved?: () => void;
    readonly onSent?: () => void;
    readonly quotedHtml?: string;
    readonly replyToMessageId?: string | null;
    readonly sourceFolder?: string;
}

interface AddressInputMockProps {
    readonly label: string;
    readonly onChange: (value: string) => void;
    readonly value: string;
}

interface MailBlockEditorMockHandle {
    readonly replaceBlocks: ReturnType<typeof vi.fn>;
}

interface MailBlockEditorMockProps {
    readonly editorRef: RefObject<MailBlockEditorMockHandle | null>;
    readonly onChange: (value: string) => void;
}

interface MountedRoot {
    readonly container: HTMLDivElement;
    readonly root: Root;
}

const TypedMailComposer = MailComposer as unknown as ComponentType<MailComposerProps>;


const mocks = vi.hoisted(() => {
    const toast = Object.assign(vi.fn<ToastMockCall>(), {
        error: vi.fn<ToastMockCall>(),
        success: vi.fn<ToastMockCall>(),
    });
    return {
        deleteMailDraft: vi.fn<DeleteMailDraft>(),
        generateMailDraft: vi.fn<GenerateMailDraft>(),
        replyMailMultipart: vi.fn<ReplyMailMultipart>(),
        saveMailDraft: vi.fn<SaveMailDraft>(),
        sendMailMultipart: vi.fn<SendMailMultipart>(),
        toast,
    };
});

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: unknown): unknown => fallback || key,
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

vi.mock('./MailAddressInput', () => ({
    AddressInput: ({ label, onChange, value }: AddressInputMockProps) => (
        <input
            aria-label={label}
            value={value}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
                onChange(event.target.value);
            }}
        />
    ),
}));

vi.mock('./MailBlockEditor', () => ({
    default: ({ editorRef, onChange }: MailBlockEditorMockProps) => {
        editorRef.current = {
            replaceBlocks: vi.fn(),
        };
        return (
            <textarea
                aria-label="mail-body"
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                    onChange(event.target.value);
                }}
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

const mountedRoots: MountedRoot[] = [];
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteMailDraft.mockResolvedValue({ status: 'success' });
    mocks.generateMailDraft.mockResolvedValue({
        draft: 'Generated reply',
        provider: 'test',
    });
    mocks.replyMailMultipart.mockResolvedValue({ status: 'success' });
    mocks.saveMailDraft.mockResolvedValue({
        draft_id: 'draft-saved',
        imap_uid: null,
        status: 'success',
    });
    mocks.sendMailMultipart.mockResolvedValue({ status: 'success' });
});

afterEach(() => {
    while (mountedRoots.length) {
        const mountedRoot = mountedRoots.pop();
        if (!mountedRoot) throw new Error('Mounted mail composer root is missing.');
        const { container, root } = mountedRoot;
        act(() => {
            root.unmount();
        });
        container.remove();
    }
    vi.useRealTimers();
});

function renderComposer(props: Partial<MailComposerProps> = {}): { container: HTMLDivElement } {
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
            <TypedMailComposer
                account={account}
                accounts={[account]}
                onClose={vi.fn()}
                {...props}
            />,
        );
    });
    return { container };
}

function changeValue(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
): void {
    const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (!descriptor?.set) throw new Error('Native input value setter is missing.');
    const setValue = descriptor.set.bind(element);
    setValue(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonContaining(container: HTMLElement, text: string): HTMLButtonElement {
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((candidate) => candidate.textContent.includes(text));
    if (!button) throw new Error(`Button containing ${text} is missing.`);
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
        const body = container.querySelector<HTMLTextAreaElement>(
            'textarea[aria-label="mail-body"]',
        );
        const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
        if (!body || !fileInput) throw new Error('Mail body or attachment input is missing.');
        const attachment = new File(['engine'], 'engine.txt', { type: 'text/plain' });

        act(() => {
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
        const sendCall = mocks.sendMailMultipart.mock.calls.at(0);
        if (!sendCall) throw new Error('Multipart send call is missing.');
        const [email, formData] = sendCall;
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
        const body = container.querySelector<HTMLTextAreaElement>(
            'textarea[aria-label="mail-body"]',
        );
        if (!body) throw new Error('Mail body input is missing.');

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
        const replyCall = mocks.replyMailMultipart.mock.calls.at(0);
        if (!replyCall) throw new Error('Multipart reply call is missing.');
        const [messageId, email, folder, formData] = replyCall;
        expect(messageId).toBe('message/42');
        expect(email).toBe('smtp@example.test');
        expect(folder).toBe('Sent Items');
        expect(formData.get('body')).toBe('Generated reply');
        expect(mocks.sendMailMultipart).not.toHaveBeenCalled();
    });
});
