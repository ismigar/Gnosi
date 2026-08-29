import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PdfAnnotationsToCite } from './PdfAnnotationsToCite';


const mocks = vi.hoisted(() => ({
    fetchAnnotations: vi.fn(),
    logError: vi.fn(),
    writeText: vi.fn(),
}));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (
            key: string,
            values?: Readonly<Record<string, unknown>>,
        ) => typeof values?.defaultValue === 'string'
            ? values.defaultValue
            : key,
    }),
}));


vi.mock('../../lib/notifyError', () => ({ logError: mocks.logError }));
vi.mock('../../lib/toast', () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));
vi.mock('../../shared/api/citations', () => ({
    fetchPdfAnnotations: mocks.fetchAnnotations,
}));


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement;
let root: Root;
let resolveAnnotations: ((value: Array<{
    color: string | null;
    comment: string | null;
    created_at: string | null;
    id: number;
    page: number;
    rects: Array<Record<string, number>>;
    source_uri: string;
    tags: string | null;
    text: string | null;
    type: string;
    updated_at: string | null;
}>) => void) | null;


beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    resolveAnnotations = null;
    vi.resetAllMocks();
    mocks.writeText.mockResolvedValue(undefined);
    mocks.fetchAnnotations.mockImplementation(() => new Promise((resolve) => {
        resolveAnnotations = resolve;
    }));
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: mocks.writeText },
    });
});


afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});


describe('PdfAnnotationsToCite', () => {
    it('loads textual annotations and copies canonical markdown citations', async () => {
        act(() => {
            root.render(
                <PdfAnnotationsToCite
                    citationKey="garcia2026"
                    sourceUri="file:///paper.pdf"
                />,
            );
        });
        const finishAnnotations = resolveAnnotations;
        if (!finishAnnotations) throw new Error('Annotation request did not start');
        await act(async () => {
            finishAnnotations([{
                color: '#ffd54f',
                comment: null,
                created_at: null,
                id: 7,
                page: 2,
                rects: [],
                source_uri: 'file:///paper.pdf',
                tags: null,
                text: 'A useful finding',
                type: 'highlight',
                updated_at: null,
            }]);
            await Promise.resolve();
        });
        expect(container.textContent).toContain('A useful finding');
        const copy = container.querySelector<HTMLButtonElement>(
            'button[title="Copy as markdown quote"]',
        );
        if (!copy) throw new Error('Copy quote action was not rendered');
        await act(async () => {
            copy.click();
            await Promise.resolve();
        });
        expect(mocks.writeText).toHaveBeenCalledWith(
            '> A useful finding\n>\n> — [@garcia2026] p. 3\n',
        );
    });

    it('shows guidance without starting a request when no PDF is associated', () => {
        act(() => {
            root.render(<PdfAnnotationsToCite />);
        });
        expect(container.textContent).toContain('No PDF associated');
        expect(mocks.fetchAnnotations).not.toHaveBeenCalled();
    });
});
