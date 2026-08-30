import React, { act, createRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logError } from '../../../shared/notifications/notifyError';
import { transportFetch } from '../../../shared/api/transports';
import { EmbedRenderer } from './EmbedRenderer';
import {
    VaultEditorContext,
    type VaultEditorContextValue,
} from '../../../shared/editor/VaultEditorContext';


vi.mock('../../../shared/resources/fileResource', () => ({
    withActiveVault: (url: string) => url,
}));


vi.mock('../../../shared/notifications/notifyError', () => ({
    logError: vi.fn(),
}));


vi.mock('../../../shared/api/transports', () => ({
    transportFetch: vi.fn(),
}));


vi.mock('react-i18next', () => {
    const t = (
        key: string,
        options?: string | Readonly<Record<string, unknown>>,
    ): string => typeof options === 'string'
        ? options
        : typeof options?.defaultValue === 'string'
            ? options.defaultValue
            : key;
    return { useTranslation: () => ({ t }) };
});


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


interface EmbedUpdate {
    readonly props: {
        readonly caption: string;
        readonly url: string;
    };
}


interface RenderOptions {
    readonly caption?: unknown;
    readonly ref?: React.RefObject<HTMLDivElement | null>;
    readonly requestInsertContent?: (
        options: Readonly<{ initialTab: string }>,
    ) => unknown;
    readonly url?: unknown;
}


const baseContext: VaultEditorContextValue = {
    allTables: [],
    idToTitle: {},
    onCreateRecord: null,
    onDeletePage: null,
    onEditSchema: null,
    onOpenParallel: null,
    pageId: null,
    registry: { databases: [], tables: [], views: [] },
};
const updateBlock = vi.fn<(id: string, update: EmbedUpdate) => void>();
let container: HTMLDivElement;
let root: Root;


beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(transportFetch).mockResolvedValue(new Response(null, {
        status: 200,
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});


afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    vi.useRealTimers();
});


function render(element: ReactElement): void {
    act(() => {
        root.render(element);
    });
}


function renderEmbed({
    caption = '',
    ref,
    requestInsertContent,
    url = '',
}: RenderOptions): void {
    const contextValue: VaultEditorContextValue = {
        ...baseContext,
        requestInsertContent,
    };
    render(
        <VaultEditorContext.Provider value={contextValue}>
            <EmbedRenderer
                ref={ref}
                block={{ id: 'embed-1', props: { caption, url } }}
                editor={{ updateBlock }}
            />
        </VaultEditorContext.Provider>,
    );
}


function buttonWithText(label: string): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(label));
    if (!button) throw new Error(`Missing button: ${label}`);
    return button;
}


async function flushUpdates(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}


describe('EmbedRenderer', () => {
    it('renders the empty accessible fallback and updates from both pickers', async () => {
        const requestInsertContent = vi.fn<(
            options: Readonly<{ initialTab: string }>,
        ) => Promise<Readonly<{ url: string }>>>()
            .mockResolvedValueOnce({ url: 'Assets/selected.png' })
            .mockResolvedValueOnce({ url: 'https://example.com/embed' });
        const forwardedRef = createRef<HTMLDivElement>();
        renderEmbed({
            caption: 'Research media',
            ref: forwardedRef,
            requestInsertContent,
        });

        expect(container.textContent).toContain('Embedded frame');
        expect(container.textContent).toContain('Choose a file from the Vault');
        expect(forwardedRef.current).toBeInstanceOf(HTMLDivElement);

        act(() => {
            buttonWithText('Choose file…').click();
        });
        await flushUpdates();
        act(() => {
            buttonWithText('External URL').click();
        });
        await flushUpdates();

        expect(requestInsertContent.mock.calls).toEqual([
            [{ initialTab: 'vault' }],
            [{ initialTab: 'url' }],
        ]);
        expect(updateBlock.mock.calls).toEqual([
            ['embed-1', {
                props: { caption: 'Research media', url: 'Assets/selected.png' },
            }],
            ['embed-1', {
                props: {
                    caption: 'Research media',
                    url: 'https://example.com/embed',
                },
            }],
        ]);
    });


    it('renders every supported media format and secure external action', () => {
        renderEmbed({ caption: 'Paper', url: '/paper.pdf?download=1' });
        let frame = container.querySelector('iframe');
        expect(frame?.getAttribute('src')).toBe('/paper.pdf?download=1');
        expect(frame?.getAttribute('loading')).toBe('lazy');
        expect(frame?.getAttribute('title')).toBe('Paper');

        renderEmbed({ url: 'https://youtu.be/video-id' });
        frame = container.querySelector('iframe');
        expect(frame?.getAttribute('src')).toBe(
            'https://www.youtube.com/embed/video-id',
        );
        expect(frame?.hasAttribute('allowfullscreen')).toBe(true);
        expect(frame?.getAttribute('allow')).toContain('encrypted-media');

        renderEmbed({ url: 'https://vimeo.com/123456/private-hash' });
        frame = container.querySelector('iframe');
        expect(frame?.getAttribute('src')).toBe(
            'https://player.vimeo.com/video/123456?h=private-hash',
        );
        expect(frame?.getAttribute('allow')).toBe(
            'autoplay; fullscreen; picture-in-picture',
        );

        renderEmbed({ url: '/clip.webm' });
        expect(container.querySelector('video')?.controls).toBe(true);
        renderEmbed({ url: '/interview.m4a' });
        expect(container.querySelector('audio')?.controls).toBe(true);
        renderEmbed({ caption: 'Diagram', url: '/diagram.svg#layer' });
        expect(container.querySelector('img')?.getAttribute('alt')).toBe(
            'Diagram',
        );

        renderEmbed({ caption: 'Dashboard', url: 'https://example.com/app' });
        frame = container.querySelector('iframe');
        expect(frame?.getAttribute('src')).toBe('https://example.com/app');
        const externalLink = container.querySelector('a');
        expect(externalLink?.getAttribute('target')).toBe('_blank');
        expect(externalLink?.getAttribute('rel')).toBe('noopener noreferrer');
        expect(container.textContent).toContain('Dashboard');
    });


    it('detects a missing local file and relinks it through the local picker', async () => {
        vi.mocked(transportFetch).mockResolvedValueOnce(new Response(null, {
            status: 404,
        }));
        const requestInsertContent = vi.fn<(
            options: Readonly<{ initialTab: string }>,
        ) => Promise<Readonly<{ url: string }>>>()
            .mockResolvedValueOnce({ url: '/api/vault/local-file/relinked' });
        renderEmbed({
            caption: 'Local recording',
            requestInsertContent,
            url: '/api/vault/local-file/missing',
        });
        await flushUpdates();

        expect(transportFetch).toHaveBeenCalledWith(
            '/api/vault/local-file/missing',
            { method: 'HEAD' },
        );
        expect(container.textContent).toContain('File not found');
        expect(container.textContent).toContain('/api/vault/local-file/missing');
        act(() => {
            buttonWithText('Re-link').click();
        });
        await flushUpdates();

        expect(requestInsertContent).toHaveBeenCalledWith({
            initialTab: 'local',
        });
        expect(updateBlock).toHaveBeenCalledWith('embed-1', {
            props: {
                caption: 'Local recording',
                url: '/api/vault/local-file/relinked',
            },
        });
    });


    it('retries an image after its first materialization failure', async () => {
        vi.useFakeTimers();
        renderEmbed({ caption: 'Cloud image', url: '/cloud.png' });
        const initialImage = container.querySelector('img');
        if (!initialImage) throw new Error('Missing initial image');
        act(() => {
            initialImage.dispatchEvent(new Event('error'));
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });

        const retriedImage = container.querySelector('img');
        expect(retriedImage).not.toBe(initialImage);
        expect(retriedImage?.getAttribute('src')).toBe('/cloud.png');
        expect(retriedImage?.getAttribute('alt')).toBe('Cloud image');
    });


    it('does not update when the picker is unavailable', () => {
        renderEmbed({ caption: 'Untouched' });
        act(() => {
            buttonWithText('Choose file…').click();
        });
        expect(updateBlock).not.toHaveBeenCalled();
        expect(logError).not.toHaveBeenCalled();
    });


    it('ignores dismissed pickers and reports operational failures', async () => {
        const requestInsertContent = vi.fn<(
            options: Readonly<{ initialTab: string }>,
        ) => Promise<never>>()
            .mockRejectedValueOnce(new Error('picker cancelled'))
            .mockRejectedValueOnce(new Error('picker failed'));
        renderEmbed({ requestInsertContent });

        act(() => {
            buttonWithText('Choose file…').click();
        });
        await flushUpdates();
        expect(logError).not.toHaveBeenCalled();

        act(() => {
            buttonWithText('External URL').click();
        });
        await flushUpdates();
        expect(logError).toHaveBeenCalledOnce();
        const [scope, reportedError] = vi.mocked(logError).mock.calls[0] ?? [];
        expect(scope).toBe('embed-picker');
        expect(reportedError).toBeInstanceOf(Error);
        if (!(reportedError instanceof Error)) {
            throw new Error('Expected the picker failure to remain an Error');
        }
        expect(reportedError.message).toBe('picker failed');
        expect(updateBlock).not.toHaveBeenCalled();
    });
});
