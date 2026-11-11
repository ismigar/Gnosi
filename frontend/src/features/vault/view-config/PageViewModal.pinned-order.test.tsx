import { describe, expect, it } from 'vitest';
import { actAndFlush, existingView, renderModal, requireButton, requireElement } from './PageViewModal.test-harness';
import { readPinnedViews } from './page-view-modal/pinned-views';

const requireDialog = () =>
    requireElement(document.body, '[role="dialog"][aria-labelledby="page-view-modal-title"]', HTMLDivElement);

const anchor = { ...existingView, id: 'order-anchor', tabs: ['order-other'] };
const other = { ...existingView, id: 'order-other', name: 'Chronology' };
const hidden = { ...existingView, id: 'order-hidden', name: 'Hidden' };
const order = () => [...requireDialog().querySelectorAll('[role="switch"]')].map(el => el.getAttribute('aria-label'));

describe('embedded tab ordering', () => {
    it('restores registry pins, moves the anchor, saves an order-only change and restores it on reopening', async () => {
        const { rerender, onClose } = await renderModal(undefined, {
            pageId: 'order-page', editingBlock: { props: { view_id: anchor.id }, view: anchor },
        }, api => { api.fetchVaultViews.mockResolvedValue([hidden, anchor, other]); });
        expect(order()).toEqual(['Alphabetical', 'Chronology', 'Resources', 'Hidden']);
        expect(requireElement(requireDialog(), 'button[aria-label="Up: Alphabetical"]', HTMLButtonElement).disabled).toBe(true);
        expect(requireElement(requireDialog(), 'button[aria-label="Down: Chronology"]', HTMLButtonElement).disabled).toBe(true);
        expect(requireDialog().querySelector('[role="switch"][aria-label="Alphabetical"]')?.getAttribute('aria-disabled')).toBe('true');
        await actAndFlush(() => { requireElement(requireDialog(), 'button[aria-label="Up: Chronology"]', HTMLButtonElement).click(); });
        expect(order()).toEqual(['Chronology', 'Alphabetical', 'Resources', 'Hidden']);
        await actAndFlush(() => { requireButton(requireDialog(), 'Insert').click(); });
        expect(onClose).toHaveBeenCalled();
        expect([...readPinnedViews('order-page', anchor.id)]).toEqual([other.id, anchor.id]);
        await rerender({ isOpen: false });
        await rerender({ isOpen: true });
        expect(order()).toEqual(['Chronology', 'Alphabetical', 'Resources', 'Hidden']);
        await actAndFlush(() => { (requireDialog().querySelector('[role="switch"][aria-label="Chronology"]') as HTMLElement).click(); });
        await actAndFlush(() => { requireButton(requireDialog(), 'Insert').click(); });
        expect([...readPinnedViews('order-page', anchor.id)]).toEqual([anchor.id]);
        await rerender({ isOpen: false });
        await rerender({ isOpen: true });
        expect(requireDialog().querySelector('[role="switch"][aria-label="Chronology"]')?.getAttribute('aria-checked')).toBe('false');
    });
});
