import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../tests/mount-react';
import { fetchPublication, type PublicationBundle } from '../../../shared/api/vault-publishing';
import { PublishedMarkdown } from './PublishedMarkdown';
import PublishedSite from './PublishedSite';
import { publishedLink } from './publicMarkdownLinks';

vi.mock('../../../shared/api/vault-publishing', () => ({ fetchPublication: vi.fn() }));
vi.mock('react-i18next', () => {
    const t = (key: string, fallback?: string) => fallback ?? key;
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
const bundle: PublicationBundle = { title: 'Selected notes', published_at: 100, expires_at: null, revision: 1,
    pages: [{ id: 'p1', title: 'First', markdown: '# Intro\n\n[Second](gnosi-published:p2#Topic)\n\n**Visible**', omissions: 0 },
        { id: 'p2', title: 'Second', markdown: '## Topic\n\nFull selected content', omissions: 0 }] };
const token = 'a'.repeat(43);
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
    Element.prototype.scrollIntoView = vi.fn();
    window.history.replaceState(null, '', `/p/${token}`);
    vi.mocked(fetchPublication).mockResolvedValue(bundle);
});
afterEach(() => {
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
    // The shared mount helper may unmount after this file's cleanup hook.
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

describe('snapshot-only public reader', () => {
    it('loads once, navigates crosslinks and searches only its bundle', async () => {
        const view = mountTestComponent(<PublishedSite />);
        await settle();
        expect(view.container.textContent).toContain('Visible');
        act(() => { view.container.querySelector<HTMLAnchorElement>('article a')?.click(); });
        expect(view.container.textContent).toContain('Full selected content');
        expect(window.location.search).toBe('?page=p2');
        expect(fetchPublication).toHaveBeenCalledOnce();
        const input = view.container.querySelector<HTMLInputElement>('input[type="search"]');
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'not in these snapshots');
            input?.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(view.container.textContent).toContain('No matching published notes');
        expect(fetchPublication).toHaveBeenCalledOnce();
    });

    it('shows unavailable for invalid and revoked tokens without falling back to private APIs', async () => {
        window.history.replaceState(null, '', '/p/invalid');
        const invalid = mountTestComponent(<PublishedSite />);
        await settle();
        expect(invalid.container.textContent).toContain('This publication is unavailable');
        expect(fetchPublication).not.toHaveBeenCalled();
        invalid.unmount();
        window.history.replaceState(null, '', `/p/${token}`);
        vi.mocked(fetchPublication).mockRejectedValue(new Error('Not found'));
        const revoked = mountTestComponent(<PublishedSite />);
        await settle();
        expect(revoked.container.textContent).toContain('This publication is unavailable');
        expect(fetchPublication).toHaveBeenCalledOnce();
    });

    it('blocks private URLs, images, raw HTML, queries and unselected links even in a malformed bundle', () => {
        const network = vi.fn(); vi.stubGlobal('fetch', network);
        const markdown = `![private](/api/vault/assets/secret.png)\n\n![remote](https://tracker.test/pixel)\n\n<iframe src="/api/vault/raw/private.pdf"></iframe>\n\n[private](/api/vault/pages/one)\n\n<https://gnosi.test/api/vault/raw/secret.zip>\n\n[unknown](gnosi-published:p99)\n\n[external](https://example.org/guide)\n\n\`\`\`query\nsecret property\n\`\`\`\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n$x^2$`;
        const view = mountTestComponent(<PublishedMarkdown markdown={markdown} bundle={bundle} onNavigate={vi.fn()} />);
        expect(view.container.querySelector('img, iframe, video, audio, object, embed')).toBeNull();
        expect(view.container.textContent).not.toContain('secret property');
        expect(view.container.querySelectorAll('a')).toHaveLength(1);
        expect(view.container.querySelector('a')?.href).toBe('https://example.org/guide');
        expect(view.container.querySelector('a')?.rel).toBe('noopener noreferrer');
        expect(view.container.querySelector('table')).not.toBeNull();
        expect(view.container.querySelector('.katex')).not.toBeNull();
        expect(network).not.toHaveBeenCalled();
        expect(publishedLink(`${location.origin}/private`, bundle)).toBeNull();
        expect(publishedLink('javascript:alert(1)', bundle)).toBeNull();
        expect(publishedLink('https://example.org/%61pi/private', bundle)).toBeNull();
    });
});
