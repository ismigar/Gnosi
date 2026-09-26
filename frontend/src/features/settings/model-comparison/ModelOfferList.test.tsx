import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ModelOfferList } from './ModelOfferList';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('offer previews', () => {
    it('opens on hover, stays open over the preview, and dismisses with Escape or leaving', async () => {
        vi.useFakeTimers();
        const container = document.createElement('section');
        container.className = 'model-comparison-modal';
        document.body.append(container);
        const root = createRoot(container);
        try {
            await act(async () => { root.render(<ModelOfferList offers={['first', 'second']} renderOffer={value => <div key={value}>{value}</div>} />); });
            const field = container.querySelector('.model-offer-list');
            const button = container.querySelector('button');
            expect(container.textContent).not.toContain('second');
            await act(async () => { field?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
            expect(button?.getAttribute('aria-expanded')).toBe('true');
            const popup = container.querySelector('.model-details-popover');
            expect(popup?.textContent).toContain('second');
            expect(field?.textContent).not.toContain('second');
            await act(async () => {
                field?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
                popup?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                vi.advanceTimersByTime(200);
            });
            expect(container.querySelector('.model-details-popover')).not.toBeNull();
            await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
            expect(container.querySelector('.model-details-popover')).toBeNull();
            await act(async () => { button?.click(); });
            expect(container.querySelector('.model-details-popover')).not.toBeNull();
            await act(async () => {
                container.querySelector('.model-details-popover')?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
                vi.advanceTimersByTime(200);
            });
            expect(container.querySelector('.model-details-popover')).toBeNull();
        } finally {
            await act(async () => { root.unmount(); });
            container.remove();
            vi.useRealTimers();
        }
    });
});
