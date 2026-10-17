import { dispatchWindowEvent } from '../platform/browser-events';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { GnosiApiError } from '../api/errors';
import { currentRequestContext, type RequestContext } from '../api/request-context';
import { fetchVaultPage, resolveVaultTitle, type VaultPage } from '../api/vaults';
import { emitAppEvent } from '../platform/app-events';
import { VaultMarkdown, VaultMarkdownTransclusion } from './VaultMarkdown';
import { MAX_TRANSCLUSION_DEPTH } from './vault-markdown/transclusionModel';
import { claimSpeechFocus, currentSpeechActivity } from '../speech/speechFocus';

vi.mock('../api/vaults', () => ({ fetchVaultPage: vi.fn(), resolveVaultTitle: vi.fn() }));
vi.mock('../api/request-context', async importOriginal => ({
    ...await importOriginal<typeof import('../api/request-context')>(), currentRequestContext: vi.fn(),
}));
vi.mock('../page-search/EmbeddedVaultSearch', () => ({
    EmbeddedVaultSearch: ({ query }: { query: string }) => <section data-embedded-query={query} />,
}));
vi.mock('react-i18next', () => {
    const t = (key: string, fallback?: string) => fallback ?? key;
    return { useTranslation: () => ({ t }) };
});

const initialScope: RequestContext = { userEmail: 'fixture@example.invalid', userId: 'user', vaultId: 'vault-a', workspaceId: 'workspace-a' };
function page(id: string, content: string): VaultPage {
    return { id, content, title: `Title ${id}`, metadata: {}, etag: id, folder: '' };
}
async function settle(): Promise<void> {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(complete => { resolve = complete; });
    return { promise, resolve };
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(currentRequestContext).mockReturnValue(initialScope);
    vi.mocked(resolveVaultTitle).mockResolvedValue({ id: null });
    vi.mocked(fetchVaultPage).mockResolvedValue(page('a', 'Body'));
});
afterEach(() => { vi.clearAllMocks(); });

describe('rich transclusions', () => {
    it('renders complete rich source content and nested embeds without treating body clicks as navigation', async () => {
        const tail = `First ${'word '.repeat(80)}final words beyond the old limit`;
        const body = `# Heading\n\n**Strong text**\n\n${tail}\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n\`\`\`ts\nconst value = 1;\n\`\`\`\n\n$x^2$\n\n![Photo](Assets/photo.png)\n\n![[b]]\n\n[Web](https://example.invalid/)`;
        vi.mocked(fetchVaultPage).mockImplementation(id => Promise.resolve(page(id, id === 'a' ? body : 'Nested **body**')));
        const onOpen = vi.fn();
        const view = mountTestComponent(<VaultMarkdownTransclusion target="a" idToTitle={{ a: 'A', b: 'B' }} onOpenInCurrentTab={onOpen} vaultId="vault-a" />);
        await settle();
        expect(view.container.textContent).toContain(tail);
        expect(view.container.querySelector('strong')?.textContent).toBe('Strong text');
        expect(view.container.querySelector('table')).not.toBeNull();
        expect(view.container.querySelector('pre code')?.textContent).toContain('const value = 1;');
        expect(view.container.querySelector('.katex')).not.toBeNull();
        expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/api/vault/assets/photo.png?vault=vault-a');
        expect(view.container.textContent).toContain('Nested body');
        act(() => { view.container.querySelector('strong')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(onOpen).not.toHaveBeenCalled();
        const header = view.container.querySelector<HTMLButtonElement>('button[title="editor.open_embedded_note"]');
        act(() => { header?.click(); });
        expect(onOpen).toHaveBeenCalledWith('a');
    });

    it('renders headings and multiline block references, with explicit missing-section feedback', async () => {
        vi.mocked(fetchVaultPage).mockResolvedValue(page('a', '# Selected\n\nFirst **line**\nsecond line ^block\n\n# Other\nHidden'));
        const view = mountTestComponent(<VaultMarkdownTransclusion target="a" section="^block" idToTitle={{ a: 'A' }} />);
        await settle();
        expect(view.container.querySelector('strong')?.textContent).toBe('line');
        expect(view.container.textContent).toContain('First line\nsecond line');
        expect(view.container.textContent).not.toContain('Hidden');
        view.render(<VaultMarkdownTransclusion target="a" section="Selected" idToTitle={{ a: 'A' }} />);
        await settle();
        expect(view.container.querySelector('h1')?.textContent).toBe('Selected');
        view.render(<VaultMarkdownTransclusion target="a" section="Missing" idToTitle={{ a: 'A' }} />);
        await settle();
        expect(view.container.textContent).toContain('editor.section_not_found');
        expect(view.container.textContent).not.toContain('First line');
    });

    it.each(['Move', '^block'])('preserves all reference forms and first-definition precedence in %s embeds', async section => {
        const body = '[manual]: https://example.invalid/first "Guide title"\n\n## Move\n\n[Full][manual] [manual][] [manual] ![Full][manual] ![manual][] ![manual] ^block\n\n[MANUAL]: https://example.invalid/ignored\n\n## Keep\n\nUnrelated private paragraph\n';
        vi.mocked(fetchVaultPage).mockResolvedValue(page('a', body));
        const view = mountTestComponent(<VaultMarkdownTransclusion target="a" section={section} idToTitle={{ a: 'A' }} />);
        await settle();
        expect([...view.container.querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(Array(3).fill('https://example.invalid/first'));
        expect([...view.container.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual(Array(3).fill('https://example.invalid/first'));
        expect(view.container.querySelector('a')?.getAttribute('title')).toBe('Guide title');
        expect(view.container.textContent).not.toContain('Unrelated private paragraph');
        expect(view.container.textContent).not.toContain('https://example.invalid/ignored');
    });

    it('uses multiline definitions in containers and keeps reference-looking examples literal', async () => {
        const body = '```md\n[manual]: https://example.invalid/code\n```\n\n## Move\n\n[Guide][manual]\n\n`[manual]`\n\n```md\n[manual]\n```\n\n## Keep\n\n> [manual]:\n>   <https://example.invalid/guide>\n>   "Quoted guide"\n';
        vi.mocked(fetchVaultPage).mockResolvedValue(page('a', body));
        const view = mountTestComponent(<VaultMarkdownTransclusion target="a" section="Move" idToTitle={{ a: 'A' }} />);
        await settle();
        expect(view.container.querySelector('a')?.getAttribute('href')).toBe('https://example.invalid/guide');
        expect(view.container.querySelector('a')?.getAttribute('title')).toBe('Quoted guide');
        expect(view.container.querySelectorAll('a')).toHaveLength(1);
        expect(view.container.querySelectorAll('code')).toHaveLength(2);
        expect(view.container.textContent).not.toContain('https://example.invalid/code');
    });

    it('stops cyclic and deep references before issuing another request', async () => {
        vi.mocked(fetchVaultPage).mockImplementation(id => Promise.resolve(page(id, id === 'a' ? '![[b]]' : '![[a]]')));
        const view = mountTestComponent(<VaultMarkdownTransclusion target="a" idToTitle={{ a: 'A', b: 'B' }} />);
        await settle();
        expect(fetchVaultPage).toHaveBeenCalledTimes(2);
        expect(view.container.textContent).toContain('This embed refers back');
        view.unmount();
        vi.mocked(fetchVaultPage).mockClear();
        vi.mocked(fetchVaultPage).mockImplementation(id => Promise.resolve(page(id, `![[n${String(Number(id.slice(1)) + 1)}]]`)));
        const index = Object.fromEntries(Array.from({ length: MAX_TRANSCLUSION_DEPTH + 2 }, (_, i) => [`n${String(i)}`, `Note ${String(i)}`]));
        const deep = mountTestComponent(<VaultMarkdownTransclusion target="n0" idToTitle={index} />);
        await settle();
        expect(fetchVaultPage).toHaveBeenCalledTimes(MAX_TRANSCLUSION_DEPTH);
        expect(deep.container.textContent).toContain('Open this note to continue');
    });

    it('resolves missing index entries, exposes missing targets, and refreshes after saves and deletion', async () => {
        vi.mocked(resolveVaultTitle).mockResolvedValue({ id: 'resolved' });
        vi.mocked(fetchVaultPage).mockResolvedValueOnce(page('resolved', 'Original body')).mockResolvedValueOnce(page('resolved', 'Updated **body**'))
            .mockRejectedValueOnce(new GnosiApiError(new Response(null, { status: 404 }), null));
        const view = mountTestComponent(<VaultMarkdownTransclusion target="Unindexed" />);
        await settle();
        expect(resolveVaultTitle).toHaveBeenCalledWith('Unindexed', expect.any(AbortSignal), initialScope);
        expect(view.container.textContent).toContain('Original body');
        act(() => { emitAppEvent('gnosi:invalidatePreview', { pageId: 'unrelated' }); });
        await settle();
        expect(fetchVaultPage).toHaveBeenCalledTimes(1);
        act(() => { emitAppEvent('gnosi:invalidatePreview', { pageId: 'resolved' }); });
        await settle();
        expect(view.container.textContent).toContain('Updated body');
        expect(view.container.textContent).not.toContain('Original body');
        act(() => { emitAppEvent('gnosi:page-deleted', { pageId: 'resolved' }); });
        await settle();
        expect(view.container.textContent).toContain('editor.note_not_found');
        expect(view.container.textContent).not.toContain('Updated body');
    });

    it('clears stale content/errors and aborts obsolete requests when the target changes or unmounts', async () => {
        const old = deferred<VaultPage>();
        vi.mocked(fetchVaultPage).mockReturnValueOnce(old.promise).mockResolvedValueOnce(page('b', 'New target body'));
        const index = { a: 'A', b: 'B' };
        const view = mountTestComponent(<VaultMarkdownTransclusion target="a" idToTitle={index} />);
        const firstSignal = vi.mocked(fetchVaultPage).mock.calls[0]?.[1];
        view.render(<VaultMarkdownTransclusion target="b" idToTitle={index} />);
        await settle();
        expect(firstSignal?.aborted).toBe(true);
        await act(async () => { old.resolve(page('a', 'Obsolete body')); await Promise.resolve(); });
        expect(view.container.textContent).toContain('New target body');
        expect(view.container.textContent).not.toContain('Obsolete body');
        const nextSignal = vi.mocked(fetchVaultPage).mock.calls[1]?.[1];
        view.unmount();
        expect(nextSignal?.aborted).toBe(true);
    });

    it('pins vault/workspace context and does not continue an old title lookup after switching vault', async () => {
        const old = deferred<Awaited<ReturnType<typeof resolveVaultTitle>>>();
        vi.mocked(resolveVaultTitle).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ id: 'new-id' });
        vi.mocked(fetchVaultPage).mockResolvedValue(page('new-id', 'New vault body'));
        const view = mountTestComponent(<VaultMarkdownTransclusion target="Title" />);
        const firstSignal = vi.mocked(resolveVaultTitle).mock.calls[0]?.[1];
        const newScope = { ...initialScope, vaultId: 'vault-b', workspaceId: 'workspace-b' };
        vi.mocked(currentRequestContext).mockReturnValue(newScope);
        act(() => { emitAppEvent('gnosi:vault-changed', { id: 'vault-b', name: 'B', slug: 'b' }); });
        await settle();
        await act(async () => { old.resolve({ id: 'old-id' }); await Promise.resolve(); });
        expect(firstSignal?.aborted).toBe(true);
        expect(fetchVaultPage).toHaveBeenCalledTimes(1);
        expect(fetchVaultPage).toHaveBeenCalledWith('new-id', expect.any(AbortSignal), newScope);
        expect(view.container.textContent).toContain('New vault body');
    });

    it.each(['userId', 'userEmail', 'workspaceId', 'vaultId'] as const)('clears visible content on storage changes to %s before the next response', async field => {
        const next = deferred<VaultPage>();
        vi.mocked(fetchVaultPage).mockResolvedValueOnce(page('a', 'Previous scope content')).mockReturnValueOnce(next.promise);
        const view = mountTestComponent(<VaultMarkdownTransclusion target="a" idToTitle={{ a: 'A' }} />);
        await settle();
        expect(view.container.textContent).toContain('Previous scope content');
        const firstSignal = vi.mocked(fetchVaultPage).mock.calls[0]?.[1];
        const newScope = { ...initialScope, [field]: 'new-scope' };
        vi.mocked(currentRequestContext).mockReturnValue(newScope);
        act(() => { dispatchWindowEvent(new StorageEvent('storage', { key: 'gnosi_context' })); });
        expect(view.container.textContent).not.toContain('Previous scope content');
        expect(firstSignal?.aborted).toBe(true);
        expect(fetchVaultPage).toHaveBeenLastCalledWith('a', expect.any(AbortSignal), newScope);
        await act(async () => { next.resolve(page('a', 'Current scope content')); await Promise.resolve(); });
        expect(view.container.textContent).toContain('Current scope content');
    });

    it('notices focus context changes and ignores late responses from a previous account', async () => {
        const old = deferred<VaultPage>();
        vi.mocked(fetchVaultPage).mockReturnValueOnce(old.promise).mockResolvedValueOnce(page('a', 'Current account content'));
        const view = mountTestComponent(<VaultMarkdownTransclusion target="a" idToTitle={{ a: 'A' }} />);
        const firstSignal = vi.mocked(fetchVaultPage).mock.calls[0]?.[1];
        vi.mocked(currentRequestContext).mockReturnValue({ ...initialScope, userId: 'other-user' });
        act(() => { dispatchWindowEvent(new Event('focus')); });
        await settle();
        expect(firstSignal?.aborted).toBe(true);
        expect(view.container.textContent).toContain('Current account content');
        await act(async () => { old.resolve(page('a', 'Previous account secret')); await Promise.resolve(); });
        expect(view.container.textContent).not.toContain('Previous account secret');
    });

    it('keeps code literal, sanitizes unsafe URLs, handles media, and leaves public embeds/queries inert', async () => {
        const markdown = '![[Secret note]]\n\n```query\ncontent:secret\n```\n\n`![[Inline code]]`\n\n~~~md\n![[Code]]\n~~~\n\n![[Assets/photo.png]]\n\n![[Assets/audio.mp3]]\n\n![[Assets/movie.mp4]]\n\n[Unsafe](javascript:alert%281%29)';
        const view = mountTestComponent(<VaultMarkdown md={markdown} vaultId="public-vault" />);
        await settle();
        expect(fetchVaultPage).not.toHaveBeenCalled();
        expect(resolveVaultTitle).not.toHaveBeenCalled();
        expect(view.container.querySelector('[data-embedded-query]')).toBeNull();
        expect(view.container.textContent).toContain('![[Inline code]]');
        expect(view.container.textContent).toContain('![[Code]]');
        expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/api/vault/assets/photo.png?vault=public-vault');
        expect(view.container.querySelector('audio')).not.toBeNull();
        expect(view.container.querySelector('video')).not.toBeNull();
        expect(view.container.querySelector('a')?.getAttribute('href')).not.toContain('javascript:');
        view.render(<VaultMarkdown md={'```search\ncontent:needle\n```'} allowVaultQueries />);
        expect(view.container.querySelector('[data-embedded-query]')?.getAttribute('data-embedded-query')).toBe('content:needle');
    });

    it('renders native serialized audio/video attachments with safe scoped asset URLs', () => {
        const view = mountTestComponent(<VaultMarkdown md={'[audio: Assets/recording.mp3](Assets/recording.mp3)\n\n[video: Assets/movie.mp4](Assets/movie.mp4)\n\n[file: Assets/document.pdf](Assets/document.pdf)'} vaultId="vault-a" />);
        expect(view.container.querySelector('audio')?.getAttribute('src')).toBe('/api/vault/assets/recording.mp3?vault=vault-a');
        expect(view.container.querySelector('video')?.getAttribute('src')).toBe('/api/vault/assets/movie.mp4?vault=vault-a');
        expect(view.container.querySelector('a')?.getAttribute('href')).toBe('/api/vault/assets/document.pdf?vault=vault-a');
    });

    it('coordinates generated speech attachments with other playback before announcing actual sound', () => {
        const stopPrevious = vi.fn();
        const previous = claimSpeechFocus(stopPrevious); previous.publish('speaking');
        const view = mountTestComponent(<VaultMarkdown md={'[audio: Generated speech](data/podcasts/speech-fixture.mp3)'} vaultId="vault-a" />);
        const audio = view.container.querySelector('audio');
        if (!audio) throw new Error('Missing generated speech attachment');
        vi.spyOn(audio, 'pause').mockImplementation(() => undefined);
        act(() => { audio.dispatchEvent(new Event('play')); });
        expect(stopPrevious).toHaveBeenCalledOnce(); expect(currentSpeechActivity()).toBe('preparing');
        act(() => { audio.dispatchEvent(new Event('playing')); });
        expect(currentSpeechActivity()).toBe('speaking');
        view.unmount(); previous.release();
        expect(currentSpeechActivity()).toBe('idle');
    });

    it('does not expand escaped embeds or embedded-looking examples inside mixed/long code fences', async () => {
        const view = mountTestComponent(<VaultMarkdown allowVaultQueries md={'\\![[escaped]]\n\n````md\n```\n:::toggle Example\n![[literal]]\n:::\n~~~\n````'} />);
        await settle();
        expect(fetchVaultPage).not.toHaveBeenCalled();
        expect(resolveVaultTitle).not.toHaveBeenCalled();
        expect(view.container.textContent).toContain('![[escaped]]');
        expect(view.container.textContent).toContain('![[literal]]');
        expect(view.container.querySelector('details')).toBeNull();
    });
});
