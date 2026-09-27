import { dispatchWindowEvent } from '../../../shared/platform/browser-events';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ModelOfferList } from './ModelOfferList';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('offer previews', () => {
    it('opens on hover, stays open over the preview, and dismisses with Escape or leaving', () => {
        vi.useFakeTimers();
        const container = document.createElement('section');
        container.className = 'model-comparison-modal';
        document.body.append(container);
        const root = createRoot(container);
        try {
            act(() => { root.render(<ModelOfferList offers={['first', 'second']} renderOffer={value => <div key={value}>{value}</div>} />); });
            const field = container.querySelector('.model-offer-list');
            const button = container.querySelector('button');
            expect(container.textContent).not.toContain('second');
            act(() => { field?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
            expect(button?.getAttribute('aria-expanded')).toBe('true');
            const popup = container.querySelector('.model-details-popover');
            expect(popup?.textContent).toContain('second');
            expect(field?.textContent).not.toContain('second');
            act(() => {
                field?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
                popup?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                vi.advanceTimersByTime(200);
            });
            expect(container.querySelector('.model-details-popover')).not.toBeNull();
            act(() => { dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
            expect(container.querySelector('.model-details-popover')).toBeNull();
            act(() => { button?.click(); });
            expect(container.querySelector('.model-details-popover')).not.toBeNull();
            act(() => {
                container.querySelector('.model-details-popover')?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
                vi.advanceTimersByTime(200);
            });
            expect(container.querySelector('.model-details-popover')).toBeNull();
        } finally {
            act(() => { root.unmount(); });
            container.remove();
            vi.useRealTimers();
        }
    });
});
