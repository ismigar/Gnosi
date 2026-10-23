import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GnosiApiError } from '../../../shared/api/errors';
import { mountTestComponent } from '../../../../tests/mount-react';
import * as api from '../../../shared/api/web-publishing';
import { currentRequestContext } from '../../../shared/api/request-context';
import { dispatchWindowEvent } from '../../../shared/platform/browser-events';
import WebPublishingManager from './WebPublishingManager';

vi.mock('../../../shared/api/web-publishing', () => ({ webStatus: vi.fn(), webPreview: vi.fn(), webPublish: vi.fn(), webRollback: vi.fn(), newsletterStatus: vi.fn(), newsletterPreview: vi.fn(), newsletterSend: vi.fn() }));
vi.mock('../../../shared/api/request-context', () => ({ currentRequestContext: vi.fn() }));
vi.mock('../../../shared/hooks/useModalKeyboard', () => ({ useModalKeyboard: () => undefined }));
vi.mock('react-i18next', () => {
    const t = (key: string) => key;
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
const context = { userId: 'owner', workspaceId: 'workspace', vaultId: 'vault', userEmail: 'owner@example.invalid' };
const firstPage = { id: 'one', title: 'One', language: 'ca', type: 'article', published: false, eligible: true };
const status: api.WebStatus = { configured: true, target: 'staging', pages: [
    firstPage,
    { id: 'legacy', title: 'Legacy', language: 'fr', type: 'article', published: true, eligible: false },
], releases: [] };
const preview: api.WebPreview = { preview_id: 'reviewed', expires_at: '2030-01-01T00:00:00Z', target: 'staging', changes: [{ kind: 'create', title: 'One', language: 'ca', url: '/one' }], warnings: [] };
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
function button(container: HTMLElement, key: string) {
    const result = [...container.querySelectorAll('button')].find(item => item.textContent === key);
    if (!result) throw new Error(`Missing button ${key}`);
    return result;
}
function pending<T>() {
    let resolve: (value: T) => void = () => { throw new Error('Promise not initialized'); };
    const promise = new Promise<T>(complete => { resolve = complete; });
    return { promise, resolve };
}
function refresh(container: HTMLElement) {
    const result = container.querySelector<HTMLButtonElement>('button[aria-label="common.refresh"]');
    if (!result) throw new Error('Refresh missing');
    return result;
}
afterEach(() => { vi.useRealTimers(); });
beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(currentRequestContext).mockReturnValue(context);
    vi.mocked(api.webStatus).mockResolvedValue(status);
    vi.mocked(api.newsletterStatus).mockResolvedValue({ subscribers: { pending: 1, active: 2, unsubscribed: 3 }, campaigns: [], test_mode: true });
    vi.mocked(api.webPreview).mockResolvedValue(preview);
    vi.mocked(api.webPublish).mockResolvedValue({ release_id: 'release', staging_url: 'https://example.invalid', target: 'staging' });
});

describe('staging web publication', () => {
    it('reviews explicit additions and withdrawals and publishes the reviewed token only', async () => {
        const view = mountTestComponent(<WebPublishingManager onClose={vi.fn()} onBack={vi.fn()} />);
        await settle();
        expect(button(view.container, 'webPublishing.publish').disabled).toBe(true);
        const switches = view.container.querySelectorAll<HTMLElement>('[role="switch"]');
        expect(switches).toHaveLength(3);
        expect(switches[1]?.getAttribute('aria-disabled')).toBe('true');
        act(() => { switches[0]?.click(); switches[2]?.click(); });
        act(() => { button(view.container, 'webPublishing.review').click(); }); await settle();
        expect(api.webPreview).toHaveBeenCalledWith(['one'], ['legacy'], context, expect.any(AbortSignal));
        act(() => { button(view.container, 'webPublishing.publish').click(); }); await settle();
        expect(api.webPublish).toHaveBeenCalledWith('reviewed', context, expect.any(AbortSignal));
    });

    it('invalidates reviewed previews when selection changes or the driver reports stale content', async () => {
        const view = mountTestComponent(<WebPublishingManager onClose={vi.fn()} onBack={vi.fn()} />); await settle();
        const first = view.container.querySelector<HTMLElement>('[role="switch"]');
        act(() => { first?.click(); });
        act(() => { button(view.container, 'webPublishing.review').click(); }); await settle();
        act(() => { first?.click(); });
        expect(button(view.container, 'webPublishing.publish').disabled).toBe(true);
        act(() => { first?.click(); });
        act(() => { button(view.container, 'webPublishing.review').click(); }); await settle();
        vi.mocked(api.webPublish).mockRejectedValue(new Error('stale'));
        act(() => { button(view.container, 'webPublishing.publish').click(); }); await settle();
        expect(button(view.container, 'webPublishing.publish').disabled).toBe(true);
        expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
    });

    it('previews a newsletter in a restricted iframe and queues only its reviewed token', async () => {
        vi.mocked(api.newsletterPreview).mockResolvedValue({ preview_id: 'mail-reviewed', subject: 'Test', body_html: '<p>Test</p>', recipient_count: 2, test_mode: true });
        vi.mocked(api.newsletterSend).mockResolvedValue({ campaign_id: 'campaign', queued: 2, test_mode: true });
        const view = mountTestComponent(<WebPublishingManager onClose={vi.fn()} onBack={vi.fn()} />); await settle();
        const subject = view.container.querySelector<HTMLInputElement>('input');
        const body = view.container.querySelector<HTMLTextAreaElement>('textarea');
        expect([...view.container.querySelectorAll('select option')].map(option => option.getAttribute('value'))).toEqual(['ca', 'es', 'en-gb']);
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(subject, 'Test');
            subject?.dispatchEvent(new Event('input', { bubbles: true }));
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(body, 'Test body');
            body?.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => { button(view.container, 'webPublishing.reviewMail').click(); }); await settle();
        expect(api.newsletterPreview).toHaveBeenCalledWith({ subject: 'Test', body_markdown: 'Test body', language: 'ca' }, context, expect.any(AbortSignal));
        const iframe = view.container.querySelector('iframe');
        expect(iframe?.getAttribute('sandbox')).toBe('');
        expect(iframe?.getAttribute('srcdoc')).toContain("default-src 'none'");
        act(() => { button(view.container, 'webPublishing.queue').click(); }); await settle();
        expect(api.newsletterSend).toHaveBeenCalledWith('mail-reviewed', context, expect.any(AbortSignal));
        expect(button(view.container, 'webPublishing.queue').disabled).toBe(true);
    });

    it.each(['userId', 'workspaceId', 'vaultId'] as const)('removes private content and cancels requests when %s changes', async part => {
        vi.mocked(api.webStatus).mockReturnValue(new Promise(() => undefined));
        const close = vi.fn();
        const view = mountTestComponent(<WebPublishingManager onClose={close} onBack={vi.fn()} />); await settle();
        const signal = vi.mocked(api.webStatus).mock.calls[0]?.[1];
        vi.mocked(currentRequestContext).mockReturnValue({ ...context, [part]: 'other' });
        act(() => { dispatchWindowEvent(new Event('storage')); });
        expect(view.container.textContent).toBe('');
        expect(signal?.aborted).toBe(true);
        expect(close).toHaveBeenCalledOnce();
    });

    it('bounds a never-resolving website read and retries without accepting its late answer', async () => {
        vi.useFakeTimers();
        const old = pending<api.WebStatus>();
        vi.mocked(api.webStatus).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...status, pages: [{ ...firstPage, title: 'Fresh catalog' }] });
        const view = mountTestComponent(<WebPublishingManager onClose={vi.fn()} onBack={vi.fn()} />); await settle();
        expect(view.container.textContent).toContain('webPublishing.loadingWeb');
        expect(api.newsletterStatus).not.toHaveBeenCalled();
        const signal = vi.mocked(api.webStatus).mock.calls[0]?.[1];
        await act(async () => { await vi.advanceTimersByTimeAsync(64_999); });
        expect(refresh(view.container).disabled).toBe(true);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(signal?.aborted).toBe(true);
        expect(view.container.textContent).not.toContain('webPublishing.loadingWeb');
        expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('webPublishing.webReadFailed');
        expect(refresh(view.container).disabled).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        act(() => { refresh(view.container).click(); }); await settle();
        expect(view.container.textContent).toContain('Fresh catalog');
        await act(async () => { old.resolve({ ...status, pages: [{ ...firstPage, title: 'Obsolete catalog' }] }); await old.promise; });
        expect(view.container.textContent).not.toContain('Obsolete catalog');
        expect(view.container.textContent).toContain('Fresh catalog');
        expect(api.newsletterStatus).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('retains the catalog when newsletter reading times out and unlocks website actions afterwards', async () => {
        vi.useFakeTimers();
        const mail = pending<api.NewsletterStatus>();
        vi.mocked(api.newsletterStatus).mockReturnValue(mail.promise);
        const view = mountTestComponent(<WebPublishingManager onClose={vi.fn()} onBack={vi.fn()} />); await settle();
        expect(view.container.textContent).toContain('One');
        expect(view.container.textContent).toContain('webPublishing.loadingNewsletter');
        const first = view.container.querySelector<HTMLElement>('[role="switch"]');
        expect(first?.getAttribute('aria-disabled')).toBe('true');
        act(() => { first?.click(); button(view.container, 'webPublishing.review').click(); });
        expect(api.webPreview).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
        expect(vi.mocked(api.newsletterStatus).mock.calls[0]?.[1]?.aborted).toBe(true);
        expect(view.container.textContent).not.toContain('webPublishing.loadingNewsletter');
        expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('webPublishing.newsletterReadFailed');
        expect(first?.getAttribute('aria-disabled')).toBeNull();
        expect(refresh(view.container).disabled).toBe(false);
        act(() => { first?.click(); });
        act(() => { button(view.container, 'webPublishing.review').click(); }); await settle();
        expect(api.webPreview).toHaveBeenCalledOnce();
        await act(async () => { mail.resolve({ subscribers: { pending: 0, active: 999, unsubscribed: 0 }, campaigns: [], test_mode: true }); await mail.promise; });
        expect(view.container.textContent).not.toContain('webPublishing.counts');
        expect(view.container.textContent).toContain('webPublishing.newsletterReadFailed');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('uses a localized read error for unavailable status instead of showing preview expiry', async () => {
        const payload = { detail: { code: 'web_publishing_unavailable', message: 'Preview expired' } };
        vi.mocked(api.webStatus).mockRejectedValue(new GnosiApiError(Response.json(payload, { status: 503 }), payload));
        const view = mountTestComponent(<WebPublishingManager onClose={vi.fn()} onBack={vi.fn()} />); await settle();
        expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('webPublishing.webReadFailed');
        expect(view.container.textContent).not.toContain('Preview expired');
        expect(api.newsletterStatus).not.toHaveBeenCalled();
        expect(refresh(view.container).disabled).toBe(false);
    });

    it('clears previous reviewed previews when refreshing', async () => {
        const view = mountTestComponent(<WebPublishingManager onClose={vi.fn()} onBack={vi.fn()} />); await settle();
        act(() => { view.container.querySelector<HTMLElement>('[role="switch"]')?.click(); });
        act(() => { button(view.container, 'webPublishing.review').click(); }); await settle();
        expect(button(view.container, 'webPublishing.publish').disabled).toBe(false);
        vi.mocked(api.webStatus).mockReturnValue(new Promise(() => undefined));
        act(() => { refresh(view.container).click(); }); await settle();
        expect(view.container.textContent).not.toContain('webPublishing.expires');
        expect(api.webPublish).not.toHaveBeenCalled();
    });

    it('cleans up the active deadline and aborts a newsletter request on unmount', async () => {
        vi.useFakeTimers();
        vi.mocked(api.newsletterStatus).mockReturnValue(new Promise(() => undefined));
        const view = mountTestComponent(<WebPublishingManager onClose={vi.fn()} onBack={vi.fn()} />); await settle();
        expect(vi.getTimerCount()).toBe(1);
        const signal = vi.mocked(api.newsletterStatus).mock.calls[0]?.[1];
        view.unmount();
        expect(signal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
    });

    it('cancels on unmount and discards a late status response', async () => {
        vi.useFakeTimers();
        let resolve: ((value: api.WebStatus) => void) | undefined;
        vi.mocked(api.webStatus).mockReturnValue(new Promise(complete => { resolve = complete; }));
        const view = mountTestComponent(<WebPublishingManager onClose={vi.fn()} onBack={vi.fn()} />);
        await settle();
        const signal = vi.mocked(api.webStatus).mock.calls[0]?.[1];
        view.unmount();
        expect(signal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        await act(async () => { resolve?.(status); await Promise.resolve(); });
        expect(api.newsletterStatus).not.toHaveBeenCalled();
    });
});
