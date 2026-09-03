import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mountTestComponent } from '../../../../tests/mount-react';
import { VaultAssetImage } from './VaultAssetImage';


beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers();
});


afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});


describe('VaultAssetImage', () => {
    it('retries a transient vault asset with a cache buster', async () => {
        const onError = vi.fn();
        const view = mountTestComponent(
            <VaultAssetImage
                alt="custom"
                onError={onError}
                retryDelaysMs={[1000]}
                src="/api/vault/assets/Icons/custom.png?vault=one"
            />,
        );
        const image = view.container.querySelector('img');
        if (!image) throw new Error('Missing image');

        act(() => {
            image.dispatchEvent(new Event('error'));
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(999);
        });
        expect(image.getAttribute('src')).not.toContain('gnosi_asset_retry');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(image.getAttribute('src')).toContain('gnosi_asset_retry=1');
        expect(onError).not.toHaveBeenCalled();
        view.unmount();
    });

    it('does not retry an arbitrary external image', () => {
        const onError = vi.fn();
        const view = mountTestComponent(
            <VaultAssetImage alt="external" onError={onError} src="https://example.test/x.png" />,
        );
        const image = view.container.querySelector('img');
        if (!image) throw new Error('Missing image');

        act(() => {
            image.dispatchEvent(new Event('error'));
        });
        expect(onError).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        view.unmount();
    });

    it('retries the current vault asset after the source changes', async () => {
        const view = mountTestComponent(
            <VaultAssetImage
                alt="custom"
                retryDelaysMs={[1000]}
                src="/api/vault/assets/Icons/first.png"
            />,
        );
        const image = view.container.querySelector('img');
        if (!image) throw new Error('Missing image');

        act(() => {
            image.dispatchEvent(new Event('error'));
        });
        view.render(
            <VaultAssetImage
                alt="custom"
                retryDelaysMs={[1000]}
                src="/api/vault/assets/Icons/second.png"
            />,
        );
        act(() => {
            image.dispatchEvent(new Event('error'));
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });

        expect(image.getAttribute('src')).toContain('second.png');
        expect(image.getAttribute('src')).toContain('gnosi_asset_retry=1');
        view.unmount();
    });
});
