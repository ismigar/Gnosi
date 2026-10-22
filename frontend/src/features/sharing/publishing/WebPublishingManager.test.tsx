import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
const status: api.WebStatus = { configured: true, target: 'staging', pages: [
    { id: 'one', title: 'One', language: 'ca', type: 'article', published: false, eligible: true },
    { id: 'legacy', title: 'Legacy', language: 'fr', type: 'article', published: true, eligible: false },
], releases: [] };
const preview: api.WebPreview = { preview_id: 'reviewed', expires_at: '2030-01-01T00:00:00Z', target: 'staging', changes: [{ kind: 'create', title: 'One', language: 'ca', url: '/one' }], warnings: [] };
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
function button(container: HTMLElement, key: string) {
    const result = [...container.querySelectorAll('button')].find(item => item.textContent === key);
    if (!result) throw new Error(`Missing button ${key}`);
    return result;
}
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
        const close = vi.fn();
        const view = mountTestComponent(<WebPublishingManager onClose={close} onBack={vi.fn()} />); await settle();
        const signal = vi.mocked(api.webStatus).mock.calls[0]?.[1];
        vi.mocked(currentRequestContext).mockReturnValue({ ...context, [part]: 'other' });
        act(() => { dispatchWindowEvent(new Event('storage')); });
        expect(view.container.textContent).toBe('');
        expect(signal?.aborted).toBe(true);
        expect(close).toHaveBeenCalledOnce();
    });

    it('cancels on unmount and discards a late status response', async () => {
        let resolve: ((value: api.WebStatus) => void) | undefined;
        vi.mocked(api.webStatus).mockReturnValue(new Promise(complete => { resolve = complete; }));
        const view = mountTestComponent(<WebPublishingManager onClose={vi.fn()} onBack={vi.fn()} />);
        await settle();
        const signal = vi.mocked(api.webStatus).mock.calls[0]?.[1];
        view.unmount();
        expect(signal?.aborted).toBe(true);
        await act(async () => { resolve?.(status); await Promise.resolve(); });
        expect(api.newsletterStatus).not.toHaveBeenCalled();
    });
});
