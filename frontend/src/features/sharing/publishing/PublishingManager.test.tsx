import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../tests/mount-react';
import { commitPublication, fetchPublicationPages, fetchPublications, previewPublication, revokePublication, type PublicationPreview, type PublicationSummary } from '../../../shared/api/vault-publishing';
import { currentRequestContext } from '../../../shared/api/request-context';
import { dispatchWindowEvent } from '../../../shared/platform/browser-events';
import PublishingManager from './PublishingManager';

vi.mock('../../../shared/api/vault-publishing', () => ({ commitPublication: vi.fn(), fetchPublicationPages: vi.fn(), fetchPublications: vi.fn(), previewPublication: vi.fn(), revokePublication: vi.fn() }));
vi.mock('../../../shared/api/request-context', () => ({ currentRequestContext: vi.fn() }));
vi.mock('../../../shared/hooks/useModalKeyboard', () => ({ useModalKeyboard: () => undefined }));
vi.mock('../../../shared/ui/dialogs/ConfirmModal', () => ({ ConfirmModal: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) => isOpen ? <button onClick={onConfirm}>Confirm revoke</button> : null }));
vi.mock('react-i18next', () => {
    const t = (key: string, fallback?: string) => fallback ?? key;
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
const context = { userId: 'owner', workspaceId: 'workspace', vaultId: 'vault', userEmail: 'owner@example.invalid' };
const site: PublicationSummary = { id: 'site', title: 'Selected notes', page_ids: ['one'], revision: 1, token: 'a'.repeat(43), created_at: 100, updated_at: 100, expires_at: null, revoked: false };
const preview = { preview_id: 'b'.repeat(43), preview_expires_at: 9999999999, bundle: { title: 'Selected notes', revision: 1, published_at: 100, expires_at: null, pages: [{ id: 'p1', title: 'One', markdown: 'Exact **snapshot**', omissions: 0 }] } };
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
function pending<T>() {
    let resolve: (value: T) => void = () => { throw new Error('Promise not initialized'); };
    const promise = new Promise<T>(complete => { resolve = complete; });
    return { promise, resolve };
}
function button(container: HTMLElement, label: string): HTMLButtonElement {
    const result = [...container.querySelectorAll('button')].find(item => item.textContent === label);
    if (!result) throw new Error(`Missing button ${label}`);
    return result;
}
function value(input: HTMLInputElement, text: string) {
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(currentRequestContext).mockReturnValue(context);
    vi.mocked(fetchPublicationPages).mockResolvedValue([{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }]);
    vi.mocked(fetchPublications).mockResolvedValue([]);
    vi.mocked(previewPublication).mockResolvedValue(preview);
    vi.mocked(commitPublication).mockResolvedValue(site);
    vi.mocked(revokePublication).mockResolvedValue({ ...site, revoked: true });
});

describe('publication manager', () => {
    it('requires explicit selection and preview, and publishes only the reviewed preview ID', async () => {
        const view = mountTestComponent(<PublishingManager onClose={vi.fn()} onBack={vi.fn()} />);
        await settle();
        expect(view.container.querySelector('[role="switch"][aria-checked="true"]')).toBeNull();
        expect(button(view.container, 'Publish this preview').disabled).toBe(true);
        const title = view.container.querySelector<HTMLInputElement>('input[maxlength="160"]');
        if (!title) throw new Error('Title missing');
        value(title, 'Selected notes');
        act(() => { view.container.querySelector<HTMLElement>('[role="switch"][aria-label="One"]')?.click(); });
        act(() => { button(view.container, 'Preview selected notes').click(); });
        await settle();
        expect(previewPublication).toHaveBeenCalledWith({ title: 'Selected notes', page_ids: ['one'], expires_in_days: null, site_id: null, expected_revision: null }, context);
        expect(view.container.textContent).toContain('Exact snapshot');
        value(title, 'Changed title');
        expect(button(view.container, 'Publish this preview').disabled).toBe(true);
        act(() => { button(view.container, 'Preview selected notes').click(); }); await settle();
        act(() => { button(view.container, 'Publish this preview').click(); }); await settle();
        expect(commitPublication).toHaveBeenCalledWith(preview.preview_id, context);
        expect(view.container.textContent).toContain('/p/' + site.token);
    });

    it('updates with the saved revision, retains explicit selection and confirms revocation', async () => {
        vi.mocked(fetchPublications).mockResolvedValue([site]);
        const view = mountTestComponent(<PublishingManager onClose={vi.fn()} onBack={vi.fn()} />); await settle();
        act(() => { button(view.container, 'Update selection').click(); });
        act(() => { button(view.container, 'Preview selected notes').click(); }); await settle();
        expect(previewPublication).toHaveBeenCalledWith(expect.objectContaining({ site_id: 'site', expected_revision: 1, page_ids: ['one'] }), context);
        act(() => { button(view.container, 'Revoke').click(); });
        expect(revokePublication).not.toHaveBeenCalled();
        act(() => { button(view.container, 'Confirm revoke').click(); }); await settle();
        expect(revokePublication).toHaveBeenCalledWith(site, context);
        expect(view.container.textContent).toContain('Revoked');
    });

    it('refuses an operation after the active account or vault changes', async () => {
        vi.mocked(fetchPublications).mockResolvedValue([site]);
        const close = vi.fn();
        const view = mountTestComponent(<PublishingManager onClose={close} onBack={vi.fn()} />); await settle();
        act(() => { button(view.container, 'Update selection').click(); });
        vi.mocked(currentRequestContext).mockReturnValue({ ...context, vaultId: 'other' });
        act(() => { button(view.container, 'Preview selected notes').click(); }); await settle();
        expect(previewPublication).not.toHaveBeenCalled();
        expect(view.container.textContent).toBe('');
        expect(close).toHaveBeenCalledOnce();
    });

    it.each(['userId', 'workspaceId', 'vaultId'] as const)('removes private content when %s changes in another tab', async part => {
        vi.mocked(fetchPublications).mockResolvedValue([site]);
        const close = vi.fn();
        const view = mountTestComponent(<PublishingManager onClose={close} onBack={vi.fn()} />); await settle();
        expect(view.container.textContent).toContain(site.title);
        vi.mocked(currentRequestContext).mockReturnValue({ ...context, [part]: 'other' });
        act(() => { dispatchWindowEvent(new Event('storage')); });
        expect(view.container.textContent).toBe('');
        expect(close).toHaveBeenCalledOnce();
    });

    it('discards a late initial list after a context change without a storage event', async () => {
        const loading = pending<PublicationSummary[]>();
        vi.mocked(fetchPublications).mockReturnValue(loading.promise);
        const close = vi.fn();
        const view = mountTestComponent(<PublishingManager onClose={close} onBack={vi.fn()} />);
        vi.mocked(currentRequestContext).mockReturnValue({ ...context, userId: 'other' });
        await act(async () => { loading.resolve([site]); await loading.promise; });
        expect(view.container.textContent).toBe('');
        expect(close).toHaveBeenCalledOnce();
    });

    it('discards a late preview after a context change without a storage event', async () => {
        const preparing = pending<PublicationPreview>();
        vi.mocked(fetchPublications).mockResolvedValue([site]);
        vi.mocked(previewPublication).mockReturnValue(preparing.promise);
        const close = vi.fn();
        const view = mountTestComponent(<PublishingManager onClose={close} onBack={vi.fn()} />); await settle();
        act(() => { button(view.container, 'Update selection').click(); });
        act(() => { button(view.container, 'Preview selected notes').click(); });
        vi.mocked(currentRequestContext).mockReturnValue({ ...context, workspaceId: 'other' });
        await act(async () => { preparing.resolve(preview); await preparing.promise; });
        expect(view.container.textContent).toBe('');
        expect(close).toHaveBeenCalledOnce();
        expect(commitPublication).not.toHaveBeenCalled();
    });

    it('discards a late commit response after a context change without a storage event', async () => {
        const publishing = pending<PublicationSummary>();
        vi.mocked(fetchPublications).mockResolvedValue([site]);
        vi.mocked(commitPublication).mockReturnValue(publishing.promise);
        const close = vi.fn();
        const view = mountTestComponent(<PublishingManager onClose={close} onBack={vi.fn()} />); await settle();
        act(() => { button(view.container, 'Update selection').click(); });
        act(() => { button(view.container, 'Preview selected notes').click(); }); await settle();
        act(() => { button(view.container, 'Publish update').click(); });
        vi.mocked(currentRequestContext).mockReturnValue({ ...context, vaultId: 'other' });
        await act(async () => { publishing.resolve(site); await publishing.promise; });
        expect(view.container.textContent).toBe('');
        expect(close).toHaveBeenCalledOnce();
    });
});
