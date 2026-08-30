import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SocialNetworkIcon } from './SocialNetworkIcon';
import { BRAND_COLORS, isKnownSocialNetwork } from './socialNetworkModel';

describe('social network icons', () => {
    it.each(Object.entries(BRAND_COLORS))('preserves the %s icon and brand color', (network, color) => {
        expect(isKnownSocialNetwork(network)).toBe(true);
        const markup = renderToStaticMarkup(<SocialNetworkIcon network={network} />);
        expect(markup).toContain(`fill="${color}"`);
        expect(markup).toContain('<path d=');
        expect(markup).toContain('aria-hidden="true"');
    });

    it.each([null, undefined, {}, 'unknown', 'constructor', '__proto__'])('rejects an unknown network (%s)', network => {
        expect(isKnownSocialNetwork(network)).toBe(false);
    });

    it('keeps optional labels and dimensions accessible', () => {
        const markup = renderToStaticMarkup(<SocialNetworkIcon network="mastodon" title="Mastodon" size={32} />);
        expect(markup).toContain('aria-label="Mastodon"');
        expect(markup).toContain('role="img"');
        expect(markup).toContain('width="32"');
        expect(markup).not.toContain('aria-hidden');
        expect(renderToStaticMarkup(<SocialNetworkIcon network="unknown" />)).toBe('');
    });
});
