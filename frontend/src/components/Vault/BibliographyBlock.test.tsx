import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCitationKey } from '../../shared/api/citations';
import { fetchVaultPage, type VaultPage } from '../../shared/api/vaults';
import BibliographyBlock, {
    type BibliographyEditor,
} from './BibliographyBlock';
import {
    recursosPageToCsl,
    renderBibliography,
    type CslItem,
} from './cslEngine';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

interface TranslationOptions {
    readonly defaultValue?: string;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const translate = (key: string, options?: TranslationOptions): string => (
    options?.defaultValue ?? key
);

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));

vi.mock('../../lib/notifyError', () => ({
    logError: vi.fn(),
}));

vi.mock('../../shared/api/citations', () => ({
    resolveCitationKey: vi.fn(),
}));

vi.mock('../../shared/api/vaults', () => ({
    fetchVaultPage: vi.fn(),
}));

vi.mock('./cslEngine', () => ({
    recursosPageToCsl: vi.fn(),
    renderBibliography: vi.fn(),
}));

const resolveCitationKeyMock = vi.mocked(resolveCitationKey);
const fetchVaultPageMock = vi.mocked(fetchVaultPage);
const recursosPageToCslMock = vi.mocked(recursosPageToCsl);
const renderBibliographyMock = vi.mocked(renderBibliography);

function pageFixture(id: string): VaultPage {
    return {
        content: '',
        etag: `etag-${id}`,
        folder: 'resources',
        id,
        metadata: {},
        title: id,
    };
}

function itemFixture(id: string): CslItem {
    return { id, title: `Title ${id}`, type: 'book' };
}

async function flushAsyncWork(): Promise<void> {
    await act(async () => {
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    });
}

function findRefreshButton(container: HTMLElement): HTMLButtonElement {
    const button = container.querySelector('button[title="Refresh"]');
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Missing bibliography refresh button');
    }
    return button;
}

describe('BibliographyBlock', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        resolveCitationKeyMock.mockReset().mockImplementation((key) => Promise.resolve({
            citation_key: key,
            folder: null,
            id: key.includes('missing') ? null : `page-${key}`,
            title: null,
        }));
        fetchVaultPageMock.mockReset().mockImplementation(
            (id) => Promise.resolve(pageFixture(id)),
        );
        recursosPageToCslMock.mockReset().mockImplementation((page) => {
            if (!page) return null;
            const id = typeof page.title === 'string' ? page.title : 'unknown';
            return itemFixture(id);
        });
        renderBibliographyMock.mockReset().mockImplementation((keys) => Promise.resolve({
            entries: keys.map((key) => `<p>${key}</p>`),
            formatting: {},
        }));
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('collects nested citations in order, deduplicates them, and reports missing keys', async () => {
        const editor: BibliographyEditor = {
            document: [
                {
                    content: [
                        { type: 'cite', props: { citationKey: 'alpha-main' } },
                        {
                            type: 'link',
                            content: [
                                { type: 'cite', props: { citationKey: 'beta-main' } },
                            ],
                        },
                        { type: 'cite', props: { citationKey: 'alpha-main' } },
                    ],
                    children: [
                        {
                            content: [
                                {
                                    type: 'cite',
                                    props: { citationKey: 'missing-main' },
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        act(() => {
            root.render(
                <BibliographyBlock
                    block={{ props: { locale: 'ca-AD', style: 'ieee' } }}
                    editor={editor}
                />,
            );
        });
        await flushAsyncWork();

        expect(resolveCitationKeyMock.mock.calls.map(([key]) => key)).toEqual([
            'alpha-main',
            'beta-main',
            'missing-main',
        ]);
        const renderCall = renderBibliographyMock.mock.calls.at(-1);
        if (!renderCall) throw new Error('Missing bibliography render call');
        const [knownKeys, items, style, locale] = renderCall;
        expect(knownKeys).toEqual(['alpha-main', 'beta-main']);
        expect(items['alpha-main']?.id).toBe('page-alpha-main');
        expect(items['beta-main']?.id).toBe('page-beta-main');
        expect(style).toBe('ieee');
        expect(locale).toBe('ca-AD');
        expect(container.querySelector('.csl-bib')?.innerHTML).toBe(
            '<p>alpha-main</p><p>beta-main</p>',
        );
        expect(container.textContent).toContain('IEEE · 3 citations');
        expect(container.textContent).toContain('Unresolved citations: @missing-main');
    });

    it('tracks editor changes, handles the empty state, and refreshes the render', async () => {
        let document: unknown = [];
        let changeListener: (() => void) | undefined;
        const onChange = vi.fn((listener: () => void) => {
            changeListener = listener;
            return vi.fn();
        });
        const editor: BibliographyEditor = {
            get document() {
                return document;
            },
            onChange,
        };

        act(() => {
            root.render(<BibliographyBlock editor={editor} />);
        });
        await flushAsyncWork();
        expect(container.textContent).toContain(
            "This document doesn't have any citations yet.",
        );

        document = [{
            content: [{ type: 'cite', props: { citationKey: 'gamma-change' } }],
        }];
        if (!changeListener) throw new Error('Missing editor change listener');
        act(() => {
            changeListener?.();
        });
        await flushAsyncWork();

        expect(container.textContent).toContain('APA · 1 citations');
        expect(container.querySelector('.csl-bib')?.innerHTML).toBe(
            '<p>gamma-change</p>',
        );
        const rendersBeforeRefresh = renderBibliographyMock.mock.calls.length;
        act(() => {
            findRefreshButton(container).click();
        });
        await flushAsyncWork();
        expect(renderBibliographyMock.mock.calls.length).toBeGreaterThan(
            rendersBeforeRefresh,
        );
        expect(onChange).toHaveBeenCalled();
    });
});
