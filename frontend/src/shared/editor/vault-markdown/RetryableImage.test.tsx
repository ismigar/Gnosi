import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RetryableImage } from './RetryableImage';


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


describe('RetryableImage', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.useFakeTimers();
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        vi.useRealTimers();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('retries a temporarily unavailable synchronized image', () => {
        act(() => {
            root.render(<RetryableImage src="/api/vault/assets/image.png" title="Cover" />);
        });
        const firstImage = container.querySelector('img');
        if (!firstImage) throw new Error('Image did not render');
        act(() => {
            firstImage.dispatchEvent(new Event('error'));
            vi.advanceTimersByTime(500);
        });

        const retriedImage = container.querySelector('img');
        expect(retriedImage).not.toBe(firstImage);
        expect(retriedImage?.getAttribute('src')).toBe('/api/vault/assets/image.png');
    });

    it('cancels a scheduled retry when the preview unmounts', () => {
        act(() => {
            root.render(<RetryableImage src="/api/vault/assets/image.png" />);
        });
        const image = container.querySelector('img');
        if (!image) throw new Error('Image did not render');
        act(() => {
            image.dispatchEvent(new Event('error'));
            root.unmount();
            vi.runAllTimers();
        });
        root = createRoot(container);

        expect(vi.getTimerCount()).toBe(0);
    });
});
